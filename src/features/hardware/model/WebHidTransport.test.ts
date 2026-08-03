import { describe, expect, it } from 'vitest'

import { ResponseAssembler, splitIntoPackets } from './WebHidTransport'

/** Размер пакета обмена: задан устройством. */
const PACKET_SIZE = 64

/** Собирает пакет ответа так, как это делает устройство. */
function responsePacket(index: number, body: Uint8Array, totalLength?: number): Uint8Array {
  const packet = new Uint8Array(PACKET_SIZE)
  const view = new DataView(packet.buffer)

  view.setUint16(0, 0x0101, false)
  packet[2] = 0x05
  view.setUint16(3, index, false)

  if (index === 0) {
    view.setUint16(5, totalLength ?? body.length, false)
    packet.set(body, 7)
  } else {
    packet.set(body, 5)
  }

  return packet
}

describe('Разделение команды на пакеты', () => {
  it('короткая команда умещается в один пакет', () => {
    expect(splitIntoPackets(new Uint8Array(10))).toHaveLength(1)
  })

  it('пустая команда всё равно отправляется', () => {
    /* Команда без данных законна: у чтения состояния приложения
       нет параметров. Ноль пакетов означал бы, что устройству
       не отправлено ничего, и ответа не пришло бы никогда. */
    expect(splitIntoPackets(new Uint8Array(0))).toHaveLength(1)
  })

  it('первый пакет объявляет длину всей команды', () => {
    /* Устройство узнаёт длину только отсюда: последний пакет
       дополнен нулями, и отличить дополнение от данных иначе нечем. */
    const [first] = splitIntoPackets(new Uint8Array(200))
    const view = new DataView((first as Uint8Array).buffer)

    expect(view.getUint16(5, false)).toBe(200)
  })

  it('длинная команда делится, и номера идут подряд', () => {
    const packets = splitIntoPackets(new Uint8Array(300))

    expect(packets.length).toBeGreaterThan(1)

    packets.forEach((packet, index) => {
      const view = new DataView(packet.buffer)

      expect(view.getUint16(3, false)).toBe(index)
      expect(packet.length).toBe(PACKET_SIZE)
    })
  })

  it('данные не теряются и не повторяются при делении', () => {
    /* Потерянный байт означал бы подпись под другой транзакцией,
       чем показана человеку. */
    const command = Uint8Array.from({ length: 300 }, (_, index) => index % 251)
    const packets = splitIntoPackets(command)

    const restored = packets.flatMap((packet, index) => [...packet.subarray(index === 0 ? 7 : 5)])

    expect(restored.slice(0, command.length)).toEqual([...command])
  })
})

describe('Сборка ответа из пакетов', () => {
  it('короткий ответ собирается из одного пакета', () => {
    const assembler = new ResponseAssembler()
    const body = Uint8Array.from([1, 2, 0x90, 0x00])

    expect([...(assembler.push(responsePacket(0, body)) ?? [])]).toEqual([1, 2, 0x90, 0x00])
  })

  it('дополнение нулями в ответ не попадает', () => {
    /* Пакет всегда шестидесятичетырёхбайтовый; лишние нули, принятые
       за данные, испортили бы разбор подписи. */
    const assembler = new ResponseAssembler()

    expect(assembler.push(responsePacket(0, Uint8Array.from([0x90, 0x00])))).toHaveLength(2)
  })

  it('неполный ответ не выдаётся за готовый', () => {
    const assembler = new ResponseAssembler()

    expect(assembler.push(responsePacket(0, new Uint8Array(57), 100))).toBeNull()
  })

  it('длинный ответ собирается из нескольких пакетов', () => {
    const assembler = new ResponseAssembler()
    const first = Uint8Array.from({ length: 57 }, () => 0xaa)
    const second = Uint8Array.from({ length: 10 }, () => 0xbb)

    expect(assembler.push(responsePacket(0, first, 67))).toBeNull()

    const complete = assembler.push(responsePacket(1, second))

    expect(complete).toHaveLength(67)
    expect(complete?.[0]).toBe(0xaa)
    expect(complete?.[66]).toBe(0xbb)
  })

  it('пакеты не по порядку прерывают обмен', () => {
    /* Пропущенный пакет означает дыру в середине ответа. Собрать его
       как ни в чём не бывало значило бы разобрать подпись из мусора. */
    const assembler = new ResponseAssembler()

    assembler.push(responsePacket(0, new Uint8Array(57), 100))

    expect(() => assembler.push(responsePacket(2, new Uint8Array(10)))).toThrow(/out of order/i)
  })

  it('чужой пакет пропускается, а не ломает обмен', () => {
    const assembler = new ResponseAssembler()
    const foreign = new Uint8Array(PACKET_SIZE)

    foreign[2] = 0x01

    expect(assembler.push(foreign)).toBeNull()
    expect([...(assembler.push(responsePacket(0, Uint8Array.from([0x90, 0x00]))) ?? [])]).toEqual([
      0x90, 0x00,
    ])
  })
})
