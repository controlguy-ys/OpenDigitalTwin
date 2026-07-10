declare module 'occt-import-js' {
  export default function createOcct(): Promise<
    import('../lib/cad/occt-types').OcctModule
  >
}
