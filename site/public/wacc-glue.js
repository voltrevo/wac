const $b64 = atob("__WACC_STAGE_WASM_BASE64__");
const $wasm = new Uint8Array($b64.length);
for (let $i = 0; $i < $b64.length; $i++)
    $wasm[$i] = $b64.charCodeAt($i);
const $instance = await WebAssembly.instantiate($wasm);
const $exports = $instance.instance.exports;
const _mem = $exports.$bind$mem;
function _memEnsure(bytes) {
    const have = $exports.$bind$mem_ensure(bytes);
    if (have < bytes) {
        throw new Error(`wac: could not grow the transfer buffer to ${bytes} bytes`);
    }
}
function _memBuffer() {
    return _mem.buffer;
}
function _stringToWasm(s) {
    const bytes = new TextEncoder().encode(s);
    _memEnsure(bytes.length);
    new Uint8Array(_memBuffer(), 0, bytes.length).set(bytes);
    return $exports.$bind$str_from_mem(bytes.length);
}
function _stringFromWasm(wa) {
    const n = $exports.$bind$str_len(wa);
    _memEnsure(n);
    $exports.$bind$str_to_mem(wa);
    return new TextDecoder().decode(new Uint8Array(_memBuffer(), 0, n));
}
function _arrayToWasm_string(js) {
    if (js.length === 0)
        return $exports.$bind$arr_string_new0();
    const wa = $exports.$bind$arr_string_new(js.length, _stringToWasm(js[0]));
    for (let i = 0; i < js.length; i++) {
        $exports.$bind$arr_string_set(wa, i, _stringToWasm(js[i]));
    }
    return wa;
}
function _arrayFromWasm_string(wa) {
    const n = $exports.$bind$arr_string_len(wa);
    const out = [];
    for (let i = 0; i < n; i++) {
        const _e = $exports.$bind$arr_string_get(wa, i);
        out.push(_stringFromWasm(_e));
    }
    return out;
}
function _arrayToWasm_u8(js) {
    const n = js.length;
    // One bulk write into the staging buffer, then one call to copy it into a GC
    // array wasm-side. The old per-element loop cost n calls across the boundary.
    _memEnsure(n * 1);
    new Uint8Array(_memBuffer(), 0, n).set(js);
    return $exports.$bind$arr_u8_from_mem(n);
}
function _arrayFromWasm_i32(wa) {
    const n = $exports.$bind$arr_i32_len(wa);
    _memEnsure(n * 4);
    $exports.$bind$arr_i32_to_mem(wa);
    // slice() rather than a view: the caller keeps this, and the next transfer
    // overwrites the buffer.
    return new Int32Array(_memBuffer(), 0, n).slice();
}
function _arrayFromWasm_u8(wa) {
    const n = $exports.$bind$arr_u8_len(wa);
    _memEnsure(n * 1);
    $exports.$bind$arr_u8_to_mem(wa);
    // slice() rather than a view: the caller keeps this, and the next transfer
    // overwrites the buffer.
    return new Uint8Array(_memBuffer(), 0, n).slice();
}
/** `Built`, held by reference. Fields and methods call into the module. */
export class Built {
    $ref;
    /** The wasm reference. Hand it to another wrapper freely — nothing is copied. */
    constructor($ref) {
        this.$ref = $ref;
    }
    static $of(wasm, described) {
        return new Built($exports.$bind$s_Built_new(_arrayToWasm_u8(wasm), _stringToWasm(described)));
    }
    get wasm() {
        return _arrayFromWasm_u8($exports.$bind$s_Built_get_wasm(this.$ref));
    }
    set wasm(v) {
        $exports.$bind$s_Built_set_wasm(this.$ref, _arrayToWasm_u8(v));
    }
    get described() {
        return _stringFromWasm($exports.$bind$s_Built_get_described(this.$ref));
    }
    set described(v) {
        $exports.$bind$s_Built_set_described(this.$ref, _stringToWasm(v));
    }
    /** A plain-object snapshot. Struct-typed fields stay wrappers, so cycles are safe. */
    $toObject() {
        return { wasm: this.wasm, described: this.described };
    }
}
export function dump(src) {
    const $w$src = _arrayToWasm_u8(src);
    const _result = $exports.dump($w$src);
    return _stringFromWasm(_result);
}
export function dumpParseErrors(src) {
    const $w$src = _arrayToWasm_u8(src);
    const _result = $exports.dumpParseErrors($w$src);
    return _arrayFromWasm_i32(_result);
}
export function dumpErrors(src) {
    const $w$src = _arrayToWasm_u8(src);
    const _result = $exports.dumpErrors($w$src);
    return _arrayFromWasm_i32(_result);
}
export function dumpTypeErrors(src) {
    const $w$src = _arrayToWasm_u8(src);
    const _result = $exports.dumpTypeErrors($w$src);
    return _arrayFromWasm_i32(_result);
}
export function emit(src) {
    const $w$src = _arrayToWasm_u8(src);
    const _result = $exports.emit($w$src);
    return _arrayFromWasm_u8(_result);
}
export function blocked(src) {
    const $w$src = _arrayToWasm_u8(src);
    const _result = $exports.blocked($w$src);
    return _stringFromWasm(_result);
}
export function names(src) {
    const $w$src = _arrayToWasm_u8(src);
    const _result = $exports.names($w$src);
    return _stringFromWasm(_result);
}
export function emitFiles(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.emitFiles(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _arrayFromWasm_u8(_result);
}
export function emitFilesChecked(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.emitFilesChecked(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _arrayFromWasm_u8(_result);
}
export function emitFilesCovered(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.emitFilesCovered(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _arrayFromWasm_u8(_result);
}
export function exportSigsFiles(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.exportSigsFiles(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _stringFromWasm(_result);
}
export function bindTypesFiles(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.bindTypesFiles(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _stringFromWasm(_result);
}
export function describeFiles(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.describeFiles(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _stringFromWasm(_result);
}
export function buildFiles(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    return new Built($exports.buildFiles(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry));
}
export function describeSeparator() {
    const _result = $exports.describeSeparator();
    return _stringFromWasm(_result);
}
export function manifestFiles(wasm, paths, sources, entry, wasmName, grants) {
    const $w$wasm = _arrayToWasm_u8(wasm);
    const $w$entry = _stringToWasm(entry);
    const $w$wasmName = _stringToWasm(wasmName);
    const _result = $exports.manifestFiles($w$wasm, _arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry, $w$wasmName, grants);
    return _stringFromWasm(_result);
}
export function bindgenFiles(wasm, paths, sources, entry, lang) {
    const $w$wasm = _arrayToWasm_u8(wasm);
    const $w$entry = _stringToWasm(entry);
    const $w$lang = _stringToWasm(lang);
    const _result = $exports.bindgenFiles($w$wasm, _arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry, $w$lang);
    return _stringFromWasm(_result);
}
export function bindgenDeclinedFiles(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.bindgenDeclinedFiles(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _stringFromWasm(_result);
}
export function emitFilesSelfDescribing(paths, sources, entry, wasmName, grants) {
    const $w$entry = _stringToWasm(entry);
    const $w$wasmName = _stringToWasm(wasmName);
    const _result = $exports.emitFilesSelfDescribing(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry, $w$wasmName, grants);
    return _arrayFromWasm_u8(_result);
}
export function covTableFiles(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.covTableFiles(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _stringFromWasm(_result);
}
export function emitFilesTraced(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.emitFilesTraced(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _arrayFromWasm_u8(_result);
}
export function emitFilesTracedSlots(paths, sources, entry, slots) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.emitFilesTracedSlots(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry, slots);
    return _arrayFromWasm_u8(_result);
}
export function traceTableFiles(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.traceTableFiles(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _stringFromWasm(_result);
}
export function blockedFiles(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.blockedFiles(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _stringFromWasm(_result);
}
export function emitDeclineFiles(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.emitDeclineFiles(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _stringFromWasm(_result);
}
export function lambdaReportFiles(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.lambdaReportFiles(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _stringFromWasm(_result);
}
export function namesFiles(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.namesFiles(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _stringFromWasm(_result);
}
export function diagnoseGraph(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.diagnoseGraph(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _stringFromWasm(_result);
}
export function diagnoseGraphRendered(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.diagnoseGraphRendered(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _stringFromWasm(_result);
}
export function wireHasErrors(wire) {
    const $w$wire = _stringToWasm(wire);
    return Boolean($exports.wireHasErrors($w$wire));
}
export function diagnoseFilesRendered(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.diagnoseFilesRendered(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _stringFromWasm(_result);
}
export function diagnoseFiles(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.diagnoseFiles(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _stringFromWasm(_result);
}
export function dumpTypeErrorsFiles(paths, sources, entry) {
    const $w$entry = _stringToWasm(entry);
    const _result = $exports.dumpTypeErrorsFiles(_arrayToWasm_string(paths), _arrayToWasm_string(sources), $w$entry);
    return _arrayFromWasm_i32(_result);
}
