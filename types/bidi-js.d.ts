/**
 * bidi-js ships no types. Only the three calls the layout engine uses are
 * declared here; see node_modules/bidi-js/README.md for the rest.
 */
declare module 'bidi-js' {
  export type EmbeddingLevels = {
    /** Odd level means the character is in a right-to-left scope. */
    levels: Uint8Array
    paragraphs: { start: number; end: number; level: number }[]
  }

  export type Bidi = {
    getEmbeddingLevels(text: string, explicitDirection?: 'ltr' | 'rtl'): EmbeddingLevels
    /** Inclusive [start, end] ranges to reverse, applied in order. */
    getReorderSegments(
      text: string,
      embeddingLevels: EmbeddingLevels,
      start?: number,
      end?: number,
    ): [number, number][]
    getMirroredCharactersMap(text: string, embeddingLevels: EmbeddingLevels): Map<number, string>
  }

  export default function bidiFactory(): Bidi
}
