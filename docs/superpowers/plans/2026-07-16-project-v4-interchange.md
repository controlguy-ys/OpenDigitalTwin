# Project V4 Interchange Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add canonical Project V4 JSON export/import, a lossless structured XML representation, and a bounded seven-sheet XLSX editing workflow that validates every sheet, previews a stable semantic Diff, and applies one atomic Project mutation without embedding STEP bytes or physical deployment paths.

**Architecture:** Keep canonical JSON and its SHA-256 config Revision as the only authority. Implement one worker-safe strict XML tokenizer/serializer used by both the full V4 XML codec and the OpenXML package reader; implement the supported XLSX profile directly over the existing `fflate` dependency, with inline-string export and shared-string-compatible import. XLSX rows project only the seven approved configuration surfaces onto a cloned active Project; the full V4 validator and canonical hash run before a one-shot preview token can be atomically applied through P2 `ProjectMutationServiceV4`.

**Tech Stack:** TypeScript 6.0.3, fflate 0.8.3, React 19.2.7, Dexie 4.4.4, Vitest 4.1.10, Playwright 1.61.1, Vite 8.1.4, Web Workers, Node 22.15.1, npm 11.4.2.

## Global Constraints

- Execute codec Tasks 1-3 after P1 Project V4 Core Contracts. Task 4 and every later XLSX task also require P4 Task 1's public `expandOpcUaMappingsV4` contract. Execute Project menu/publication integration only after P2 Multi-Robot Runtime has landed.
- Canonical JSON produced by `canonicalProjectV4Json` remains the sole validation and hashing authority.
- Reject Project schema versions 1, 2, and 3 as `PROJECT_SCHEMA_UNSUPPORTED`; do not migrate or add Legacy Adoption.
- XML must round-trip the complete V4 domain configuration losslessly: `canonicalHash(JSON -> XML -> JSON) == canonicalHash(original JSON)`.
- XML includes stable IDs, Robot Definitions/Instances, Frames, Jobs, Actions, logical Asset references/digests, Endpoints, Mappings, and Bridge routes. It excludes STEP bytes, physical mount paths, live state, interpolation buffers, and Lease data.
- XLSX is not a complete Project format. It edits only `Endpoints`, `Robots`, `Joints`, `Frames`, `Mappings`, `Actions`, and `AssetReferences` against one active base Revision.
- Every XLSX row uses stable IDs and explicit units. IDs, Node IDs, hashes, URI values, and ISO timestamps are strings even when they look numeric.
- All seven sheets are required and authoritative for their represented surfaces. Removing a row means a proposed deletion and must appear in the semantic Diff.
- Validate all sheets and cells before producing an applicable candidate. Never apply valid rows while dropping invalid rows.
- Use only the existing `fflate` runtime dependency and browser/worker-safe XML helpers created by this plan. Do not add `xlsx`, SheetJS, ExcelJS, a Node DOM package, or another runtime spreadsheet/XML dependency.
- XLSX export uses inline strings, but import accepts inline strings, shared strings, numeric cells, and Boolean cells because desktop spreadsheet tools may rewrite the package.
- Reject formulas, macros, external relationships, DTD/entity declarations, duplicate sheet names, duplicate cell references, path traversal, ZIP bombs, and unsupported workbook structures with stable codes.
- Preserve V4 coordinates as metres and RPY degrees with `Rz * Ry * Rx`. Convert RPY through the dependency-free Core and keep quaternion as canonical Project state.
- Import staging is bound to one active base Revision and a one-shot preview capability. If the active Revision changes, Apply fails without mutation.
- Heavy XML/XLSX encode/decode work runs in a Web Worker; UI receives progress, diagnostics, candidate hash, and Diff only.
- Keep comments in English, preserve unrelated files, and never stage external CAD directories or generated test workbooks.
- Every task ends with focused tests, lint/build where applicable, and one commit.

---

## File Structure

**Create:**

- `src/features/interchange/xml/xml-document.ts` and test - strict worker-safe XML tokenization, entity handling, and deterministic serialization.
- `src/features/interchange/project-v4-xml.ts` and test - full lossless V4 typed XML value tree.
- `src/features/interchange/openxml/openxml-package.ts` and test - bounded `fflate` ZIP, relationship, and content-type handling.
- `src/features/interchange/openxml/xlsx-workbook.ts` and test - workbook/sheet/cell parsing and writing.
- `src/features/interchange/project-v4-workbook-schema.ts` and test - seven sheet schemas, row bounds, and typed row records.
- `src/features/interchange/project-v4-workbook-projection.ts` and test - Project-to-row and row-to-candidate projection.
- `src/features/interchange/project-v4-xlsx.ts` and test - public XLSX encode/decode.
- `src/features/interchange/project-v4-semantic-diff.ts` and test - stable ID/path additions, removals, and changes.
- `src/features/interchange/interchange-worker-protocol.ts` and test - closed worker request/result envelopes.
- `src/features/interchange/interchange-worker.ts` - browser worker entrypoint.
- `src/features/interchange/interchange-worker-client.ts` and test - request correlation, cancellation, and worker lifecycle.
- `src/features/interchange/project-interchange-service.ts` and test - one-shot preview and atomic Apply.
- `src/features/interchange/ProjectInterchangeDialog.tsx` and test - format, diagnostics, Diff, and confirmation UI.
- `tests/project-v4-interchange.spec.ts` - browser export/import/preview/apply/reload evidence.

**Modify:**

- `src/features/project/v4/project-v4-codec.ts` and test.
- `src/features/project/v4/project-v4-mutation-service.ts` and test.
- `src/features/project/v4/project-store-v4.ts` and test.
- `src/features/project/ProjectMenu.tsx` and test.
- `src/app/App.tsx`.
- `package.json` only for scripts; `package-lock.json` must not gain a new runtime package.

### Task 1: Add a Strict Worker-Safe XML Document Helper

**Files:**
- Create: `src/features/interchange/xml/xml-document.ts`
- Test: `src/features/interchange/xml/xml-document.test.ts`

**Interfaces:**
- Produces: `XmlElementV1`, `parseXmlDocumentV1`, `serializeXmlDocumentV1`, strict name/attribute/text accessors, and stable coded parse failures shared by Project XML and OpenXML.

- [ ] **Step 1: Write RED safe parsing and deterministic serialization tests**

```ts
it('parses namespace-qualified elements, attributes, text, and self-closing nodes', () => {
  const root = parseXmlDocumentV1(
    '<?xml version="1.0" encoding="UTF-8"?><x:root xmlns:x="urn:x" id="a"><x:item>1 &amp; 2</x:item><x:empty/></x:root>',
  )
  expect(root.name).toBe('x:root')
  expect(requireXmlAttributeV1(root, 'id')).toBe('a')
  expect(requireSingleXmlChildV1(root, 'x:item').text).toBe('1 & 2')
})

it.each([
  ['<!DOCTYPE root><root/>', 'XML_DTD_FORBIDDEN'],
  ['<!ENTITY x SYSTEM "file:///etc/passwd"><root/>', 'XML_ENTITY_DECLARATION_FORBIDDEN'],
  ['<root><a></root>', 'XML_TAG_MISMATCH'],
  ['<root a="1" a="2"/>', 'XML_DUPLICATE_ATTRIBUTE'],
])('rejects unsafe or malformed XML with %s', (xml, code) => {
  expect(() => parseXmlDocumentV1(xml)).toThrow(code)
})

it('serializes the same tree to byte-identical UTF-8 text', () => {
  expect(serializeXmlDocumentV1(tree)).toBe(serializeXmlDocumentV1(structuredClone(tree)))
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/interchange/xml/xml-document.test.ts
```

Expected: FAIL because no browser-safe XML helper exists.

- [ ] **Step 3: Implement the closed XML tree and tokenizer**

```ts
export interface XmlElementV1 {
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: readonly XmlElementV1[]
  readonly text: string
}

export interface XmlParseLimitsV1 {
  readonly maximumUtf8Bytes: number
  readonly maximumElements: number
  readonly maximumDepth: number
  readonly maximumAttributesPerElement: number
  readonly maximumTextCharsPerElement: number
}

export function parseXmlDocumentV1(text: string, limits?: Partial<XmlParseLimitsV1>): XmlElementV1
export function serializeXmlDocumentV1(root: XmlElementV1): string
export function requireXmlAttributeV1(element: XmlElementV1, name: string): string
export function requireSingleXmlChildV1(element: XmlElementV1, name: string): XmlElementV1
export function xmlChildrenNamedV1(element: XmlElementV1, name: string): readonly XmlElementV1[]
```

Use defaults of 16 MiB UTF-8, 200,000 elements, depth 64, 64 attributes/element, and 1 MiB text/element. Accept only the XML declaration as a processing instruction. Decode `amp`, `lt`, `gt`, `quot`, `apos`, decimal numeric, and hexadecimal numeric references; reject all named custom entities. Sort attributes lexicographically during serialization and escape text/attributes explicitly. Do not use Node APIs, DOMParser, or XMLSerializer so the helper works unchanged in Vite and a Web Worker.

- [ ] **Step 4: Run GREEN and browser-boundary scan**

```powershell
npm run test:run -- src/features/interchange/xml/xml-document.test.ts
rg -n "node:|require\(|DOMParser|XMLSerializer|document|window" src/features/interchange/xml
npm run lint
npm run build
```

Expected: tests pass and `rg` returns no Node or DOM dependency.

- [ ] **Step 5: Commit**

```powershell
git add src/features/interchange/xml
git diff --cached --check
git commit -m "feat: add strict browser xml helper"
```

### Task 2: Encode and Decode Lossless Project V4 XML

**Files:**
- Create: `src/features/interchange/project-v4-xml.ts`
- Test: `src/features/interchange/project-v4-xml.test.ts`
- Modify: `src/features/project/v4/project-v4-codec.ts`
- Modify: `src/features/project/v4/project-v4-codec.test.ts`

**Interfaces:**
- Consumes: canonical JSON, V4 validator, SHA-256 config Revision, and XML helper.
- Produces: `encodeProjectV4Xml`, `decodeProjectV4Xml`, MIME `application/vnd.webdigitaltwin.project-v4+xml`, and the lossless canonical-hash gate.

- [ ] **Step 1: Write RED full-domain and rejection tests**

```ts
it('round-trips every V4 domain surface to the same canonical hash', async () => {
  const original = completeProjectV4Fixture()
  const xml = encodeProjectV4Xml(original)
  const decoded = decodeProjectV4Xml(xml)
  expect(await configRevisionForProjectV4(decoded)).toBe(await configRevisionForProjectV4(original))
  expect(decoded).toEqual(original)
})

it('never exports bytes, physical paths, Lease, or live state', () => {
  const xml = encodeProjectV4Xml(completeProjectV4Fixture())
  expect(xml).toContain('asset://cell-library/robots/mrb05.step')
  expect(xml).not.toMatch(/sourceBytes|runtimePublisherLease|interpolationBuffer|[A-Z]:\\|\/srv\//)
})

it.each([1, 2, 3])('rejects XML schema version %i', (schemaVersion) => {
  expect(() => decodeProjectV4Xml(xmlWithSchemaVersion(schemaVersion))).toThrow('PROJECT_SCHEMA_UNSUPPORTED')
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/interchange/project-v4-xml.test.ts src/features/project/v4/project-v4-codec.test.ts
```

Expected: FAIL because V4 codec supports canonical JSON only.

- [ ] **Step 3: Implement a deterministic typed XML value tree**

Use exactly this outer contract:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<wdt:Project xmlns:wdt="urn:webdigitaltwin:project:v4" schemaVersion="4">
  <wdt:Object>
    <wdt:Property name="projectId"><wdt:String>cell-a</wdt:String></wdt:Property>
    <wdt:Property name="robots"><wdt:Array><wdt:Item><wdt:Object><wdt:Property name="id"><wdt:String>robot-a</wdt:String></wdt:Property></wdt:Object></wdt:Item></wdt:Array></wdt:Property>
  </wdt:Object>
</wdt:Project>
```

Represent values only as `wdt:Object`, `wdt:Property`, `wdt:Array`, `wdt:Item`, `wdt:String`, `wdt:Number`, `wdt:Boolean`, and `wdt:Null`. Parse `canonicalProjectV4Json(project)` to obtain normalized numbers and lexicographically ordered object keys before emission; preserve array order. On decode, reject unknown element/attribute names, duplicate Object properties, sparse Item order, non-canonical Number text, and a root/schemaVersion mismatch. Pass the reconstructed unknown value through `validateWorkcellProjectV4` before return.

```ts
export const PROJECT_V4_XML_MIME = 'application/vnd.webdigitaltwin.project-v4+xml'
export function encodeProjectV4Xml(project: WorkcellProjectV4): string
export function decodeProjectV4Xml(xml: string): WorkcellProjectV4
```

- [ ] **Step 4: Run GREEN and round-trip corpus**

Test empty optional collections, 8 Robots, 16 Joints, 7 Robot STEP references, Jobs with ordered steps, every Action union, Moving Frames, Endpoints, structured Mappings, and Bridge routes.

```powershell
npm run test:run -- src/features/interchange/project-v4-xml.test.ts src/features/project/v4
npm run lint
npm run build
```

Expected: every corpus member returns equal canonical bytes and hash; malformed/unsafe XML mutates no repository.

- [ ] **Step 5: Commit**

```powershell
git add src/features/interchange/project-v4-xml* src/features/project/v4/project-v4-codec*
git diff --cached --check
git commit -m "feat: add lossless project v4 xml"
```

### Task 3: Add a Bounded OpenXML Package Layer over fflate

**Files:**
- Create: `src/features/interchange/openxml/openxml-package.ts`
- Test: `src/features/interchange/openxml/openxml-package.test.ts`
- Modify: `src/features/interchange/xml/xml-document.ts`
- Modify: `src/features/interchange/xml/xml-document.test.ts`

**Interfaces:**
- Consumes: `fflate` `zipSync`, `unzipSync`, `strToU8`, `strFromU8`, and strict XML helper.
- Produces: `readOpenXmlPackageV1`, `writeOpenXmlPackageV1`, safe relationship resolution, and ZIP/package limits.

- [ ] **Step 1: Write RED ZIP bomb, traversal, macro, and external-link tests**

```ts
it('round-trips a deterministic set of OpenXML parts', () => {
  const bytes = writeOpenXmlPackageV1(new Map([
    ['[Content_Types].xml', utf8(contentTypesXml)],
    ['_rels/.rels', utf8(rootRelationshipsXml)],
    ['xl/workbook.xml', utf8(workbookXml)],
  ]))
  expect(readOpenXmlPackageV1(bytes).partNames()).toEqual([
    '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
  ])
})

it.each([
  ['../outside.xml', 'OPENXML_PATH_TRAVERSAL'],
  ['xl/vbaProject.bin', 'XLSX_MACRO_FORBIDDEN'],
  ['xl/externalLinks/externalLink1.xml', 'XLSX_EXTERNAL_LINK_FORBIDDEN'],
])('rejects package part %s', (partName, code) => {
  expect(() => readOpenXmlPackageV1(zipWithPart(partName))).toThrow(code)
})

it('rejects more than 64 entries and more than 50 MiB expanded bytes', () => {
  expect(() => readOpenXmlPackageV1(zipWithEntryCount(65))).toThrow('OPENXML_ENTRY_LIMIT_EXCEEDED')
  expect(() => readOpenXmlPackageV1(compressedRepeatedBytes(50 * 1024 * 1024 + 1))).toThrow('OPENXML_EXPANDED_SIZE_LIMIT_EXCEEDED')
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/interchange/openxml/openxml-package.test.ts
```

Expected: FAIL because existing `fflate` use is limited to Project archive code.

- [ ] **Step 3: Implement the package boundary**

```ts
export interface OpenXmlPackageV1 {
  partNames(): readonly string[]
  requireText(partName: string): string
  optionalText(partName: string): string | null
  resolveRelationship(sourcePart: string, relationshipId: string): string
}

export function readOpenXmlPackageV1(bytes: Uint8Array): OpenXmlPackageV1
export function writeOpenXmlPackageV1(parts: ReadonlyMap<string, Uint8Array>): Uint8Array
```

Reject input over 10 MiB compressed, more than 64 entries, more than 50 MiB total expanded bytes, any individual part over 16 MiB, duplicate normalized paths, backslashes, absolute paths, `..`, NUL, encrypted parts, macros, ActiveX, OLE, printer settings, external links, and any relationship with `TargetMode="External"`. Permit safe Excel-added `docProps/*`, `xl/theme/*`, `xl/styles.xml`, `xl/sharedStrings.xml`, and `xl/calcChain.xml`, but never execute or trust them. Sort part names before `zipSync` for deterministic output.

- [ ] **Step 4: Run GREEN and dependency check**

```powershell
npm run test:run -- src/features/interchange/openxml/openxml-package.test.ts src/features/interchange/xml
rg -n '"(xlsx|exceljs|sheetjs|@xmldom)' package.json package-lock.json
npm run lint
npm run build
```

Expected: package tests pass and dependency scan returns no spreadsheet/XML runtime package.

- [ ] **Step 5: Commit**

```powershell
git add src/features/interchange/openxml src/features/interchange/xml
git diff --cached --check
git commit -m "feat: add bounded openxml package support"
```

### Task 4: Define the Seven-Sheet Workbook Contract

**Files:**
- Create: `src/features/interchange/project-v4-workbook-schema.ts`
- Test: `src/features/interchange/project-v4-workbook-schema.test.ts`
- Create: `src/features/interchange/project-v4-workbook-projection.ts`
- Test: `src/features/interchange/project-v4-workbook-projection.test.ts`

**Interfaces:**
- Consumes: `WorkcellProjectV4`, V4 limits, rigid transform RPY conversion, and P4 `expandOpcUaMappingsV4`. Do not duplicate Mapping expansion in the interchange feature.
- Produces: exact ordered sheet/column definitions, typed workbook rows, row-bound validation, `projectV4ToWorkbookRows`, and `workbookRowsToProjectV4Candidate`.

- [ ] **Step 1: Write RED sheet, header, row-limit, and explicit-unit tests**

```ts
it('exports exactly seven ordered sheet names', () => {
  expect(PROJECT_V4_WORKBOOK_SHEETS_V1.map((sheet) => sheet.name)).toEqual([
    'Endpoints', 'Robots', 'Joints', 'Frames', 'Mappings', 'Actions', 'AssetReferences',
  ])
})

it.each([
  ['Endpoints', 8, 9],
  ['Robots', 16, 17],
  ['Joints', 128, 129],
  ['Frames', 1_024, 1_025],
  ['Mappings', 1_152, 1_153],
  ['Actions', 384, 385],
  ['AssetReferences', 184, 185],
])('%s accepts %i rows and rejects %i', (sheet, exact, plusOne) => {
  expect(() => validateWorkbookRowsV1(rowsAt(sheet, exact))).not.toThrow()
  expect(() => validateWorkbookRowsV1(rowsAt(sheet, plusOne))).toThrow('XLSX_SHEET_ROW_LIMIT_EXCEEDED')
})

it.each([
  ['bridge-route', 129, 'XLSX_MAPPING_ROUTE_ROW_CEILING_EXCEEDED'],
  ['action-binding', 129, 'XLSX_ACTION_BINDING_ROW_CEILING_EXCEEDED'],
])('treats the %s allocation as an XLSX ceiling only', (recordType, count, code) => {
  const project = otherwiseValidProjectWithRows(recordType, count)
  expect(() => validateWorkcellProjectV4(project)).not.toThrow()
  expect(() => projectV4ToWorkbookRows(project)).toThrow(code)
})

it('uses metres and RPY degrees in every pose-bearing sheet', () => {
  expect(sheet('Joints').columns).toEqual(expect.arrayContaining(['originX_M', 'originRoll_Deg']))
  expect(sheet('Frames').columns).toEqual(expect.arrayContaining(['x_M', 'roll_Deg']))
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/interchange/project-v4-workbook-schema.test.ts src/features/interchange/project-v4-workbook-projection.test.ts
```

Expected: FAIL because workbook row types and projection do not exist.

- [ ] **Step 3: Lock exact ordered columns**

Use these columns in this order:

```ts
export const PROJECT_V4_WORKBOOK_COLUMNS_V1 = {
  Endpoints: [
    'endpointId', 'name', 'endpointUrl', 'enabled', 'publishingIntervalMs', 'reconnectDelayMs',
  ],
  Robots: [
    'recordType', 'id', 'name', 'definitionId', 'manufacturer', 'model', 'parentFrameId',
    'baseX_M', 'baseY_M', 'baseZ_M', 'baseRoll_Deg', 'basePitch_Deg', 'baseYaw_Deg',
    'jointSourceOwnership',
  ],
  Joints: [
    'definitionId', 'jointId', 'type', 'parentLinkId', 'childLinkId',
    'originX_M', 'originY_M', 'originZ_M', 'originRoll_Deg', 'originPitch_Deg', 'originYaw_Deg',
    'axisX', 'axisY', 'axisZ', 'min', 'max', 'home', 'zeroOffset', 'direction', 'maximumVelocity',
  ],
  Frames: [
    'ownerType', 'ownerId', 'frameId', 'name', 'parentFrameId', 'role',
    'x_M', 'y_M', 'z_M', 'roll_Deg', 'pitch_Deg', 'yaw_Deg',
  ],
  Mappings: [
    'recordType', 'mappingId', 'leafPath', 'endpointId', 'nodeId', 'targetType', 'targetId',
    'direction', 'opcUaDataType', 'projectDataType', 'scale', 'offset', 'unit',
    'publishingIntervalMs', 'coherenceGroupId', 'required', 'sourceOwnership', 'interpolationMode',
    'sourceChannelId', 'destinationChannelId',
  ],
  Actions: [
    'recordType', 'id', 'kind', 'robotId', 'toolFrameId', 'objectId', 'objectGraspFrameId',
    'maximumDistanceM', 'targetParentFrameId', 'gripperState', 'endpointId', 'nodeId',
    'actionId', 'triggerMode', 'integerCommandValue',
  ],
  AssetReferences: [
    'assetReferenceId', 'uri', 'sha256', 'byteLength', 'sourceFileName', 'mediaType',
    'usageOwnerType', 'usageOwnerId', 'linearUnit', 'sourceToMeters', 'orientationMode',
    'upAxis', 'rootQx', 'rootQy', 'rootQz', 'rootQw',
  ],
} as const
```

Robots uses `recordType=definition` for at most eight referenced Robot Definitions and `recordType=instance` for at most eight Robot Instances. Definition rows require manufacturer/model and leave Base/ownership cells blank; Instance rows require `definitionId`, parent/Base fields, and ownership while leaving manufacturer/model blank.

Mappings uses `recordType=mapping` for one row per expanded Leaf and `recordType=bridge-route` for declared Bridge routes. Scalar Mapping `leafPath` is empty; structured rows share `mappingId` and use dot-separated property names plus zero-based `[index]` segments. Bridge rows require `mappingId` as the stable route ID, direction, scale/offset/unit conversion, `sourceChannelId`, and `destinationChannelId`, while Mapping-only Node/target cells are blank. The XLSX V1 profile reserves at most 1,024 Mapping Leaf rows plus 128 Bridge-route rows, for a 1,152-row sheet ceiling. The 128-route value is a workbook-format ceiling, not a Project V4 domain limit: export or preview of an otherwise valid Project that exceeds the format allocation fails `XLSX_MAPPING_ROUTE_ROW_CEILING_EXCEEDED` without changing the active Project. Canonical JSON and XML remain governed only by the Core domain validator.

Actions uses `recordType=definition` for the Core-bounded 256 Action definitions and `recordType=binding` for OPC UA Action Bindings. The XLSX V1 profile reserves 128 binding rows, producing a 384-row sheet ceiling; 128 is a workbook-format allocation rather than a Project domain limit. Export or preview beyond that allocation fails `XLSX_ACTION_BINDING_ROW_CEILING_EXCEEDED` atomically, while canonical JSON and XML remain governed by the Core validator. Irrelevant cells must be blank and relevant cells are required by `kind`. AssetReferences uses `usageOwnerType=robot-definition` for one of at most 56 Robot source uses plus its linear/orientation convention, or `usageOwnerType=asset-only` for one of at most 128 unique non-Robot STEP references whose existing Scene assignments remain in the base Project. Repeated `assetReferenceId` rows must repeat identical URI/digest/length/media fields.

- [ ] **Step 4: Implement reversible projection against a base Project**

```ts
export function projectV4ToWorkbookRows(project: WorkcellProjectV4): ProjectV4WorkbookRowsV1
export function workbookRowsToProjectV4Candidate(
  base: WorkcellProjectV4,
  rows: ProjectV4WorkbookRowsV1,
): WorkcellProjectV4
```

Treat every represented collection as authoritative, preserve Jobs, Scene Groups, confirmed occurrence-to-Link Geometry mapping, metadata creation time, and runtime-excluded state from the base, set `metadata.updatedAt` once from the interchange service's injected clock during preview, reconstruct quaternion fields through `rpyDegreesToQuaternionV4`, then call `validateWorkcellProjectV4`. Rebuild each Robot Definition's `assetReferenceIds` and `sourceConventions` from AssetReferences usage rows. Duplicate stable IDs, conflicting repeated Asset metadata, duplicate `(mappingId, leafPath)`, missing parents, ambiguous Action rows, and invalid units are sheet/cell diagnostics before V4 validation.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/interchange/project-v4-workbook-schema.test.ts src/features/interchange/project-v4-workbook-projection.test.ts
npm run lint
npm run build
git add src/features/interchange/project-v4-workbook-*
git diff --cached --check
git commit -m "feat: define project v4 workbook schema"
```

### Task 5: Write and Read the Supported XLSX Profile

**Files:**
- Create: `src/features/interchange/openxml/xlsx-workbook.ts`
- Test: `src/features/interchange/openxml/xlsx-workbook.test.ts`
- Create: `src/features/interchange/project-v4-xlsx.ts`
- Test: `src/features/interchange/project-v4-xlsx.test.ts`

**Interfaces:**
- Consumes: bounded OpenXML package, strict XML helper, and typed workbook rows.
- Produces: `writeXlsxWorkbookV1`, `readXlsxWorkbookV1`, `encodeProjectV4Xlsx`, and `decodeProjectV4XlsxCandidate`.

- [ ] **Step 1: Write RED deterministic package and Excel-rewrite compatibility tests**

```ts
it('writes byte-identical XLSX for identical rows', () => {
  expect(writeXlsxWorkbookV1(rows)).toEqual(writeXlsxWorkbookV1(structuredClone(rows)))
})

it('reads inline, shared-string, numeric, and Boolean cells', () => {
  const workbook = readXlsxWorkbookV1(workbookWithCellTypes({
    A2: { type: 'inlineStr', value: 'endpoint-a' },
    B2: { type: 's', sharedStringIndex: 0 },
    C2: { type: 'n', value: '100' },
    D2: { type: 'b', value: '1' },
  }))
  expect(workbook.sheet('Endpoints').row(2)).toMatchObject({
    endpointId: 'endpoint-a', name: 'Shared Name', publishingIntervalMs: 100, enabled: true,
  })
})

it.each([
  ['formula', 'XLSX_FORMULA_FORBIDDEN'],
  ['duplicate-cell', 'XLSX_DUPLICATE_CELL_REFERENCE'],
  ['duplicate-sheet', 'XLSX_DUPLICATE_SHEET_NAME'],
  ['missing-sheet', 'XLSX_REQUIRED_SHEET_MISSING'],
  ['unknown-column', 'XLSX_UNKNOWN_COLUMN'],
])('rejects %s workbooks', (fixture, code) => {
  expect(() => readXlsxWorkbookV1(invalidWorkbook(fixture))).toThrow(code)
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/interchange/openxml/xlsx-workbook.test.ts src/features/interchange/project-v4-xlsx.test.ts
```

Expected: FAIL because no XLSX reader/writer exists.

- [ ] **Step 3: Write the minimal deterministic workbook**

Generate exactly:

```text
[Content_Types].xml
_rels/.rels
xl/workbook.xml
xl/_rels/workbook.xml.rels
xl/styles.xml
xl/worksheets/sheet1.xml
xl/worksheets/sheet2.xml
xl/worksheets/sheet3.xml
xl/worksheets/sheet4.xml
xl/worksheets/sheet5.xml
xl/worksheets/sheet6.xml
xl/worksheets/sheet7.xml
```

Use inline strings (`t="inlineStr"`) for text, `t="b"` for Boolean, and numeric cells for finite numbers. Do not emit formulas, shared strings, dates, merged cells, comments, drawings, external links, or macros. Freeze panes at row 1, apply one header style, preserve ordered sheets/columns/rows, and assign stable relationship IDs `rId1` through `rId7`.

```ts
export interface XlsxWorkbookRowsV1 {
  readonly sheets: readonly { readonly name: string; readonly rows: readonly (readonly XlsxCellValueV1[])[] }[]
}

export function writeXlsxWorkbookV1(workbook: XlsxWorkbookRowsV1): Uint8Array
export function readXlsxWorkbookV1(bytes: Uint8Array): XlsxWorkbookRowsV1
export function encodeProjectV4Xlsx(project: WorkcellProjectV4): Uint8Array
export function decodeProjectV4XlsxCandidate(base: WorkcellProjectV4, bytes: Uint8Array): WorkcellProjectV4
```

- [ ] **Step 4: Implement strict reader normalization**

Resolve sheets only through internal workbook relationships. Read optional shared strings including rich-text runs by concatenating their text nodes. Reject formulas even when cached values exist, cells beyond XFD/1,048,576, duplicate coordinates, rows beyond the sheet-specific data limit plus header, cell text over 32,767 characters, non-finite numbers, style-dependent date conversion, unknown/missing headers, hidden required sheets, and extra required-sheet duplicates. Ignore safe style/theme/document-property parts after package validation.

- [ ] **Step 5: Run GREEN and round-trip all sheet limits**

```powershell
npm run test:run -- src/features/interchange/openxml src/features/interchange/project-v4-xlsx.test.ts src/features/interchange/project-v4-workbook-*
npm run lint
npm run build
```

Expected: deterministic export, Excel-style shared-string import, exact/plus-one row limits, Project round-trip, and unsafe package rejection tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/features/interchange/openxml src/features/interchange/project-v4-xlsx*
git diff --cached --check
git commit -m "feat: add bounded project v4 xlsx"
```

### Task 6: Move Interchange Encoding and Decoding into a Web Worker

**Files:**
- Create: `src/features/interchange/interchange-worker-protocol.ts`
- Test: `src/features/interchange/interchange-worker-protocol.test.ts`
- Create: `src/features/interchange/interchange-worker.ts`
- Create: `src/features/interchange/interchange-worker-client.ts`
- Test: `src/features/interchange/interchange-worker-client.test.ts`

**Interfaces:**
- Consumes: canonical JSON, XML codec, XLSX codec, transferable `ArrayBuffer`.
- Produces: one worker client for encode/decode with closed request IDs, cancellation, diagnostics, and transferable binary results.

- [ ] **Step 1: Write RED protocol and lifecycle tests**

```ts
it('correlates concurrent JSON, XML, and XLSX operations by request ID', async () => {
  const client = createInterchangeWorkerClient(fakeWorker)
  const xml = client.encodeXml(project)
  const xlsx = client.encodeXlsx(project)
  fakeWorker.respond(secondRequestId(), xlsxResult)
  fakeWorker.respond(firstRequestId(), xmlResult)
  await expect(xml).resolves.toEqual(xmlResult.text)
  await expect(xlsx).resolves.toEqual(xlsxResult.bytes)
})

it('rejects pending operations when the worker crashes', async () => {
  const pending = client.decodeXlsx(baseProject, bytes)
  fakeWorker.crash(new Error('worker failed'))
  await expect(pending).rejects.toThrow('INTERCHANGE_WORKER_FAILED')
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/interchange/interchange-worker-protocol.test.ts src/features/interchange/interchange-worker-client.test.ts
```

Expected: FAIL because interchange runs only as direct functions.

- [ ] **Step 3: Implement closed worker messages**

```ts
export type InterchangeWorkerRequestV1 =
  | { readonly version: 1; readonly requestId: string; readonly kind: 'encode-json'; readonly project: WorkcellProjectV4 }
  | { readonly version: 1; readonly requestId: string; readonly kind: 'decode-json'; readonly text: string }
  | { readonly version: 1; readonly requestId: string; readonly kind: 'encode-xml'; readonly project: WorkcellProjectV4 }
  | { readonly version: 1; readonly requestId: string; readonly kind: 'decode-xml'; readonly text: string }
  | { readonly version: 1; readonly requestId: string; readonly kind: 'encode-xlsx'; readonly project: WorkcellProjectV4 }
  | { readonly version: 1; readonly requestId: string; readonly kind: 'decode-xlsx'; readonly baseProject: WorkcellProjectV4; readonly bytes: ArrayBuffer }
  | { readonly version: 1; readonly requestId: string; readonly kind: 'cancel' }
```

Validate messages at both ends, transfer XLSX buffers rather than copy them, map `ProjectV4Error` and interchange errors to stable serializable diagnostics, and ignore a late response after cancellation. Construct the production worker with `new Worker(new URL('./interchange-worker.ts', import.meta.url), { type: 'module' })`.

- [ ] **Step 4: Run GREEN and build the worker chunk**

```powershell
npm run test:run -- src/features/interchange/interchange-worker-*
npm run lint
npm run build
```

Expected: correlation, transfer, cancel, crash, unknown response, and worker codec tests pass; Vite emits an interchange worker chunk.

- [ ] **Step 5: Commit**

```powershell
git add src/features/interchange/interchange-worker*
git diff --cached --check
git commit -m "feat: run project interchange in worker"
```

### Task 7: Add Stable Semantic Diff and One-Shot Atomic Apply

**Files:**
- Create: `src/features/interchange/project-v4-semantic-diff.ts`
- Test: `src/features/interchange/project-v4-semantic-diff.test.ts`
- Create: `src/features/interchange/project-interchange-service.ts`
- Test: `src/features/interchange/project-interchange-service.test.ts`

**Interfaces:**
- Consumes: worker decode, V4 validator/hash, active V4 bundle, and the P2-owned `ProjectMutationServiceV4`, including its expected-Revision `replacePrepared` operation for one-shot preview Apply.
- Produces: `ProjectV4SemanticDiff`, `InterchangePreviewV4`, and `ProjectInterchangeServiceV4`. P6 does not redeclare or augment `ProjectMutationServiceV4`.

- [ ] **Step 1: Write RED stable-path and atomicity tests**

```ts
it('uses stable ID paths rather than collection indexes', () => {
  const diff = createProjectV4SemanticDiff(before, afterWithRobotName('robot-b', 'Welder'))
  expect(diff.changes).toEqual([{
    kind: 'change', path: '/robots/robot-b/name', before: 'Robot B', after: 'Welder',
  }])
})

it('rejects Apply when the active base Revision changed', async () => {
  const preview = await service.previewXlsx(file, revisionA)
  await projectStore.replace(projectB)
  await expect(service.apply(preview.previewId)).rejects.toThrow('INTERCHANGE_BASE_REVISION_CHANGED')
  expect(projectStore.active().revisionId).toBe(projectB.revisionId)
})

it('does not publish any valid rows when one cell is invalid', async () => {
  await expect(service.previewXlsx(workbookWithOneInvalidCell(), revisionA))
    .rejects.toMatchObject({ diagnostics: expect.arrayContaining([
      expect.objectContaining({ sheet: 'Joints', cell: 'P4', code: 'JOINT_LIMIT_INVALID' }),
    ]) })
  expect(publication.replace).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/interchange/project-v4-semantic-diff.test.ts src/features/interchange/project-interchange-service.test.ts
```

Expected: FAIL because import has no staging or semantic Diff.

- [ ] **Step 3: Implement canonical stable-ID Diff**

```ts
export type ProjectV4SemanticChange =
  | { readonly kind: 'add'; readonly path: string; readonly after: unknown }
  | { readonly kind: 'remove'; readonly path: string; readonly before: unknown }
  | { readonly kind: 'change'; readonly path: string; readonly before: unknown; readonly after: unknown }

export interface ProjectV4SemanticDiff {
  readonly beforeConfigRevision: string
  readonly afterConfigRevision: string
  readonly changes: readonly ProjectV4SemanticChange[]
}
```

Index all stable-ID collections by ID, emit paths such as `/robotDefinitions/<id>/joints/<id>/maximumVelocity`, sort changes lexicographically by path then kind, preserve Job step order through numeric step paths, and omit derived display values.

- [ ] **Step 4: Implement one-shot preview capabilities**

```ts
export interface InterchangePreviewV4 {
  readonly previewId: string
  readonly format: 'json' | 'xml' | 'xlsx'
  readonly baseRevisionId: string
  readonly candidateConfigRevision: string
  readonly diff: ProjectV4SemanticDiff
  readonly diagnostics: readonly InterchangeDiagnosticV1[]
}

export interface ProjectInterchangeServiceV4 {
  previewJson(text: string): Promise<InterchangePreviewV4>
  previewXml(text: string): Promise<InterchangePreviewV4>
  previewXlsx(bytes: ArrayBuffer): Promise<InterchangePreviewV4>
  apply(previewId: string): Promise<void>
  discard(previewId: string): void
}
```

Store the frozen validated candidate only behind an unguessable in-memory preview ID. Bind it to the current Revision ID, expire it after 10 minutes through an injected clock, consume it before publication, and never permit replay. `replacePrepared` runs inside P2's serialized mutation queue, compares the current Revision with `expectedRevisionId`, throws `INTERCHANGE_BASE_REVISION_CHANGED` on mismatch, validates the already timestamped frozen candidate without rewriting `metadata.updatedAt`, and invokes the existing publication coordinator once. On prepare/apply/finalization failure the prior Project remains active. Because preview fixes `updatedAt`, `candidateConfigRevision` is the exact Revision that Apply publishes.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/interchange/project-v4-semantic-diff.test.ts src/features/interchange/project-interchange-service.test.ts src/features/project/v4
npm run lint
npm run build
git add src/features/interchange/project-v4-semantic-diff* src/features/interchange/project-interchange-service*
git diff --cached --check
git commit -m "feat: stage atomic project interchange"
```

### Task 8: Add Project Menu Export, Preview, and Apply UI

**Files:**
- Create: `src/features/interchange/ProjectInterchangeDialog.tsx`
- Test: `src/features/interchange/ProjectInterchangeDialog.test.tsx`
- Modify: `src/features/project/ProjectMenu.tsx`
- Modify: `src/features/project/ProjectMenu.test.tsx`
- Modify: `src/app/App.tsx`
- Create: `tests/project-v4-interchange.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: active Project store and `ProjectInterchangeServiceV4`.
- Produces: explicit JSON/XML/XLSX exports, staged import diagnostics/Diff, operator confirmation, and browser round-trip evidence.

- [ ] **Step 1: Write RED dialog behavior tests**

```tsx
it('shows sheet/cell errors and disables Apply', async () => {
  render(<ProjectInterchangeDialog service={serviceRejectingCell('Joints', 'P4')} />)
  await user.upload(screen.getByLabelText('Import Project configuration'), invalidXlsxFile)
  expect(await screen.findByText('Joints!P4')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled()
})

it('shows additions, removals, and changes before one confirmed Apply', async () => {
  render(<ProjectInterchangeDialog service={serviceWithPreview(diffFixture)} />)
  await loadPreview()
  expect(screen.getByText('/robots/robot-b/name')).toBeVisible()
  expect(screen.getByText('/opcUa/endpoints/endpoint-c')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Apply changes' }))
  expect(service.apply).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/interchange/ProjectInterchangeDialog.test.tsx src/features/project/ProjectMenu.test.tsx
```

Expected: FAIL because Project menu has only the prior archive import/export flow.

- [ ] **Step 3: Add explicit format actions and preview workflow**

Provide `Export JSON`, `Export XML`, `Export XLSX`, and `Import configuration` actions. Accept `.json`, `.xml`, and `.xlsx`; infer format from selected action plus extension and reject mismatch. Use filenames `<sanitized-project-name>-<revision-prefix>.wdtwin.json`, `.wdtwin.xml`, and `.wdtwin.xlsx`.

The dialog shows base Revision, candidate Revision, format, diagnostic count, Diff filters `All/Add/Remove/Change`, stable path, before/after values, and `Apply changes`/`Cancel`. Trap focus, restore the opener, announce worker progress, disable Apply while processing or when diagnostics exist, and warn that XLSX is a bounded configuration editor rather than a complete Project backup.

- [ ] **Step 4: Add the browser E2E scenario**

In `tests/project-v4-interchange.spec.ts`:

1. Load the complete two-Robot V4 fixture.
2. Export JSON and XML and compare decoded canonical hashes in the page.
3. Export XLSX and capture download bytes.
4. Use the page's worker codec test hook to change one Robot name, one Joint velocity, one Endpoint URL, add one Mapping, and remove one Asset reference.
5. Import the edited workbook and assert the five semantic Diff paths.
6. Cancel and prove no mutation.
7. Import again, Apply once, and prove all five changes appear together.
8. Save/reload and prove the candidate canonical hash remains active.
9. Import an invalid workbook and prove sheet/cell errors with no mutation.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/interchange src/features/project/ProjectMenu.test.tsx
npx playwright test tests/project-v4-interchange.spec.ts
npm run lint
npm run build
git add src/features/interchange src/features/project/ProjectMenu* src/app/App.tsx tests/project-v4-interchange.spec.ts package.json
git diff --cached --check
git commit -m "feat: add project interchange workflow"
```

Expected: unit, UI, worker, and browser tests pass; Cancel is non-mutating and confirmed Apply publishes exactly once.

### Task 9: Prove the P6 Lossless and Bounded Exit Gate

**Files:**
- Modify: `src/features/interchange/project-v4-xml.test.ts`
- Modify: `src/features/interchange/project-v4-xlsx.test.ts`
- Modify: `tests/project-v4-interchange.spec.ts`
- Modify: `docs/superpowers/plans/2026-07-16-project-v4-interchange.md`
- Modify: `package.json`

**Interfaces:**
- Produces: the independently testable P6 exit consumed by P8.

- [ ] **Step 1: Add the canonical corpus gate**

Run JSON -> XML -> JSON across the minimum Project, maximum bounded Project, heterogeneous two-Robot Project, every Action kind, structured Mapping arrays at depth 4, Bridge routes, and logical Assets. Assert byte-identical canonical JSON and SHA-256 after every round trip.

- [ ] **Step 2: Add the workbook security and atomicity gate**

Generate exact-limit and plus-one sheets, a shared-string rewrite, formula, macro, external relationship, 65-entry ZIP, 50 MiB plus-one expansion, duplicate cell, invalid RPY, dangling ID, and one-invalid-cell-among-valid-rows fixtures. Assert stable failures and zero publication for every rejected fixture.

- [ ] **Step 3: Add the focused script and verify no dependency drift**

```json
{
  "test:interchange": "vitest run src/features/interchange src/features/project/v4/project-v4-codec.test.ts && playwright test tests/project-v4-interchange.spec.ts"
}
```

```powershell
npm run test:interchange
npm run lint
npm run build
rg -n '"(xlsx|exceljs|sheetjs|@xmldom)' package.json package-lock.json
git diff -- package-lock.json
git status --short
```

Expected: lossless XML, bounded XLSX, worker, Diff, atomic Apply, and browser tests pass; dependency scan returns no new spreadsheet/XML package; lockfile contains no dependency change from this plan; unrelated CAD directories remain unstaged.

- [ ] **Step 4: Record evidence and commit**

Record exact unit/Playwright counts, canonical hashes, maximum workbook sizes, and rejection codes in this plan, then:

```powershell
git add src/features/interchange tests/project-v4-interchange.spec.ts package.json docs/superpowers/plans/2026-07-16-project-v4-interchange.md
git diff --cached --check
git commit -m "test: prove project v4 interchange gates"
```
