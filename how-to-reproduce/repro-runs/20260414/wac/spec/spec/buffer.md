## Buffer — growable byte buffer

A growable byte buffer demonstrating structs, methods, and dynamic resizing
in wac.

(This is an example only, not to be included in the language.)

### Implementation (using i8[])

With packed `i8[]` arrays, the implementation is straightforward — no
bit-packing needed:

```wac
struct Buffer {
  i8[] data;
  i32 len;
  i32 cap;

  Buffer create(i32 cap) {
    return Buffer(i8[cap](), 0, cap);
  }

  i32 get(const this, i32 idx) {
    if (idx < 0 || idx >= this.len) { trap; }
    return this.data[idx];
  }

  void set(this, i32 idx, i32 val) {
    if (idx < 0 || idx >= this.len) { trap; }
    this.data[idx] = val;
  }

  void push(this, i32 val) {
    if (this.len == this.cap) {
      i32 newCap = this.cap * 2;
      if (newCap == 0) { newCap = 8; }
      i8[] next = i8[newCap]();
      for (i32 i = 0; i < this.len; i++) {
        next[i] = this.data[i];
      }
      this.data = next;
      this.cap = newCap;
    }
    this.data[this.len] = val;
    this.len++;
  }

  i32 pop(this) {
    if (this.len == 0) { trap; }
    this.len--;
    return this.data[this.len];
  }

  void clear(this) {
    this.len = 0;
  }

  bool equals(const this, Buffer other) {
    if (this.len != other.len) { return false; }
    for (i32 i = 0; i < this.len; i++) {
      if (this.get(i) != other.get(i)) { return false; }
    }
    return true;
  }
}
```

Note: methods must use `this.field` and `this.method()` explicitly — bare
`field` or `method()` access without `this.` is not allowed. This applies to
all struct methods in wac.

### Bit-packed variant (using i32[])

For environments where packed arrays are not available, bytes can be manually
packed 4 per i32 using bitwise ops:

```wac
struct PackedBuffer {
  i32[] data;     // 4 bytes packed per i32
  i32 len;        // byte count
  i32 cap;        // byte capacity

  PackedBuffer create(i32 cap) {
    return PackedBuffer(i32[(cap + 3) / 4](), 0, cap);
  }

  i32 get(const this, i32 idx) {
    if (idx < 0 || idx >= this.len) { trap; }
    i32 word = this.data[idx / 4];
    i32 shift = (idx % 4) * 8;
    return (word >> shift) & 0xFF;
  }

  void set(this, i32 idx, i32 val) {
    if (idx < 0 || idx >= this.len) { trap; }
    i32 wi = idx / 4;
    i32 shift = (idx % 4) * 8;
    this.data[wi] = (this.data[wi] & ~(0xFF << shift)) | ((val & 0xFF) << shift);
  }

  void push(this, i32 val) {
    if (this.len == this.cap) {
      i32 newCap = this.cap * 2;
      if (newCap == 0) { newCap = 8; }
      i32[] next = i32[(newCap + 3) / 4]();
      for (i32 i = 0; i < this.data.len(); i++) {
        next[i] = this.data[i];
      }
      this.data = next;
      this.cap = newCap;
    }
    i32 wi = this.len / 4;
    i32 shift = (this.len % 4) * 8;
    this.data[wi] = (this.data[wi] & ~(0xFF << shift)) | ((val & 0xFF) << shift);
    this.len++;
  }

  i32 pop(this) {
    if (this.len == 0) { trap; }
    this.len--;
    return this.get(this.len);
  }

  void clear(this) {
    this.len = 0;
  }

  bool equals(const this, Buffer other) {
    if (this.len != other.len) { return false; }
    for (i32 i = 0; i < this.len; i++) {
      if (this.get(i) != other.get(i)) { return false; }
    }
    return true;
  }
}
```

### Spec tests

```wac
export i32 testBasic() {
  Buffer b = Buffer.create(4);
  b.push(0x41);
  b.push(0x42);
  b.push(0x43);
  return b.len;
}
```

`[§wac-buf-basic-k4mf2js]` `testBasic()` returns `3`.

```wac
export i32 testGetSet() {
  Buffer b = Buffer.create(4);
  b.push(10);
  b.push(20);
  b.push(30);
  return b.get(0) + b.get(1) + b.get(2);
}
```

`[§wac-buf-getset-p9qn3xl]` `testGetSet()` returns `60`.

```wac
export i32 testOverwrite() {
  Buffer b = Buffer.create(4);
  b.push(0);
  b.push(0);
  b.set(0, 0xFF);
  b.set(1, 0x80);
  return b.get(0) * 256 + b.get(1);
}
```

`[§wac-buf-overwrite-w7rk5bt]` `testOverwrite()` returns `65408` (255 * 256 +
128).

```wac
export i32 testGrow() {
  Buffer b = Buffer.create(4);
  for (i32 i = 0; i < 20; i++) {
    b.push(i);
  }
  return b.get(19) * 100 + b.len;
}
```

`[§wac-buf-grow-m3hd8qz]` `testGrow()` returns `1920` (19 * 100 + 20). The
buffer grows automatically when capacity is exceeded.

```wac
export i32 testPop() {
  Buffer b = Buffer.create(4);
  b.push(10);
  b.push(20);
  b.push(30);
  i32 last = b.pop();
  return last * 100 + b.len;
}
```

`[§wac-buf-pop-j2fn9rk]` `testPop()` returns `3002` (30 * 100 + 2).

```wac
export bool testEquals() {
  Buffer a = Buffer.create(4);
  Buffer b = Buffer.create(8);
  a.push(1); a.push(2); a.push(3);
  b.push(1); b.push(2); b.push(3);
  return a.equals(b);
}
```

`[§wac-buf-equals-h8wd2pm]` `testEquals()` returns `true`. Equality is
byte-by-byte, independent of capacity.

```wac
export i32 testBoundsGet() {
  Buffer b = Buffer.create(4);
  b.push(1);
  return b.get(5);
}
```

`[§wac-buf-oob-get-f4kp7wn]` `testBoundsGet()` traps: index out of bounds.

```wac
export i32 testBoundsSet() {
  Buffer b = Buffer.create(4);
  b.push(1);
  b.set(5, 99);
  return 0;
}
```

`[§wac-buf-oob-set-n2qm8xl]` `testBoundsSet()` traps: index out of bounds.

```wac
export i32 testPopEmpty() {
  Buffer b = Buffer.create(4);
  return b.pop();
}
```

`[§wac-buf-pop-empty-c7jw3kf]` `testPopEmpty()` traps: pop on empty buffer.
