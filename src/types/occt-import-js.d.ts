declare module 'occt-import-js' {
  interface OcctModuleOptions {
    locateFile?: (path: string, scriptDirectory: string) => string
  }

  export default function createOcct(options?: OcctModuleOptions): Promise<
    import('../lib/cad/occt-types').OcctModule
  >
}
