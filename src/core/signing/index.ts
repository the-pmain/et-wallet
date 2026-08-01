export type { ISigningService, SignableMessage } from './contracts'
export { SigningService } from './SigningService'
export {
  assertTypedDataMatchesChain,
  hashTypedData,
  stripDomainType,
  toEthersDomain,
} from './typed-data'
