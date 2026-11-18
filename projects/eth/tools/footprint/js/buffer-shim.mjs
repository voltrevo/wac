// Node's Buffer, which Lodestar's code uses, from the buffer package (as Lodestar's own browser bundle polyfills it).
import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;
