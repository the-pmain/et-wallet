import { describe, expect, it } from 'vitest'

import { ResponseAssembler, splitIntoPackets } from './WebHidTransport'

const PACKET_SIZE = 64

/** Build a reply packet the way the device does. */
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

describe('Splitting a command into packets', () => {
  it('a short command fits in one packet', () => {
    expect(splitIntoPackets(new Uint8Array(10))).toHaveLength(1)
  })

  it('an empty command is still sent', () => {
    /* A command with no data is legal: reading app state has no
       parameters. Zero packets would mean nothing was sent to the
       device, and a reply would never arrive. */
    expect(splitIntoPackets(new Uint8Array(0))).toHaveLength(1)
  })

  it('the first packet declares the full command length', () => {
    /* The device learns the length only from here: the last
       packet is padded with zeros, and there is no other way to
       tell padding from data. */
    const [first] = splitIntoPackets(new Uint8Array(200))
    const view = new DataView((first as Uint8Array).buffer)

    expect(view.getUint16(5, false)).toBe(200)
  })

  it('a long command is split and sequence numbers are consecutive', () => {
    const packets = splitIntoPackets(new Uint8Array(300))

    expect(packets.length).toBeGreaterThan(1)

    packets.forEach((packet, index) => {
      const view = new DataView(packet.buffer)

      expect(view.getUint16(3, false)).toBe(index)
      expect(packet.length).toBe(PACKET_SIZE)
    })
  })

  it('data is neither lost nor repeated when splitting', () => {
    /* A lost byte would mean a signature under a different
       transaction than the one shown to the person. */
    const command = Uint8Array.from({ length: 300 }, (_, index) => index % 251)
    const packets = splitIntoPackets(command)

    const restored = packets.flatMap((packet, index) => [...packet.subarray(index === 0 ? 7 : 5)])

    expect(restored.slice(0, command.length)).toEqual([...command])
  })
})

describe('Assembling a reply from packets', () => {
  it('a short reply is assembled from one packet', () => {
    const assembler = new ResponseAssembler()
    const body = Uint8Array.from([1, 2, 0x90, 0x00])

    expect([...(assembler.push(responsePacket(0, body)) ?? [])]).toEqual([1, 2, 0x90, 0x00])
  })

  it('zero padding does not enter the reply', () => {
    /* A packet is always sixty-four bytes; extra zeros taken as
       data would corrupt signature parsing. */
    const assembler = new ResponseAssembler()

    expect(assembler.push(responsePacket(0, Uint8Array.from([0x90, 0x00])))).toHaveLength(2)
  })

  it('an incomplete reply is not treated as ready', () => {
    const assembler = new ResponseAssembler()

    expect(assembler.push(responsePacket(0, new Uint8Array(57), 100))).toBeNull()
  })

  it('a long reply is assembled from several packets', () => {
    const assembler = new ResponseAssembler()
    const first = Uint8Array.from({ length: 57 }, () => 0xaa)
    const second = Uint8Array.from({ length: 10 }, () => 0xbb)

    expect(assembler.push(responsePacket(0, first, 67))).toBeNull()

    const complete = assembler.push(responsePacket(1, second))

    expect(complete).toHaveLength(67)
    expect(complete?.[0]).toBe(0xaa)
    expect(complete?.[66]).toBe(0xbb)
  })

  it('out-of-order packets abort the exchange', () => {
    /* A skipped packet means a hole in the middle of the reply.
       Assembling it as if nothing happened would parse a
       signature from garbage. */
    const assembler = new ResponseAssembler()

    assembler.push(responsePacket(0, new Uint8Array(57), 100))

    expect(() => assembler.push(responsePacket(2, new Uint8Array(10)))).toThrow(/out of order/i)
  })

  it('a foreign packet is skipped instead of breaking the exchange', () => {
    const assembler = new ResponseAssembler()
    const foreign = new Uint8Array(PACKET_SIZE)

    foreign[2] = 0x01

    expect(assembler.push(foreign)).toBeNull()
    expect([...(assembler.push(responsePacket(0, Uint8Array.from([0x90, 0x00]))) ?? [])]).toEqual([
      0x90, 0x00,
    ])
  })
})
