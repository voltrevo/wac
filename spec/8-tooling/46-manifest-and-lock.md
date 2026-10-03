# 46 — Manifest and lock

A project is a directory with a `wac.json5`. The manifest names the project's dependencies and, if it is a package, its
entry module ([04](../1-programs/04-packages.md)). The lock, `wac.lock`, pins each dependency to a commit, and makes every
command but one offline.

## The manifest

```json5
// wac.json5
{
  exports: "./src/lib.wac",            // the module importers of this package get

  imports: {                           // dependencies, by the package name code imports
    geometry: {
      git: "https://example.com/libraries",
      ref: "v1.2.0",
      subdir: "./packages/geometry",
    },
  },

  check: {                             // what full-project checking skips discovering
    exclude: ["./fixtures/invalid/**", "./generated/**"],
  },
}
```

| Key | Meaning |
|---|---|
| `exports` | the package's entry module, one path ([04](../1-programs/04-packages.md)) |
| `imports.<name>.git` | the repository a dependency is fetched from |
| `imports.<name>.ref` | the branch, tag or commit to resolve |
| `imports.<name>.subdir` | the package's directory in that repository; the root if omitted |
| `check.exclude` | paths full-project checking does not discover ([06](../1-programs/06-checking-a-project.md)) |

Every key is optional, and `{}` is a valid manifest: its presence is what makes a directory a project and gives its files a
`@/` ([02](../1-programs/02-modules-and-imports.md)).

`[§wac-manifest-keys-2ew4fkf]` A manifest key not listed above is refused.

Every path in a manifest begins with `./` (`§wac-manifest-dot-slash-p59q7q3`), and each `imports` key is a complete package
name (`§wac-package-key-exact-rme93fh`).

## The lock

```sh
$ wac update
geometry: fetched 4f2c91e (v1.2.0)
wrote wac.lock
$ wac update
nothing to fetch
```

`[§wac-cli-update-2rq7knp]` `wac update` resolves every dependency the lock does not already cover, fetches it, and writes
`wac.lock`. A dependency already locked stays locked even if its ref has moved since: moving a pin is what running `update`
deliberately is for.

`[§wac-update-only-network-gmppnua]` `wac update` is the only command that reaches the network. Every other command reads
dependencies from the lock and the local checkout cache.

```sh
$ wac build main.wac -o app
error: the dependency 'geometry' is not in wac.lock — run `wac update`
```

`[§wac-lock-missing-4amdnyc]` Compiling a program that needs a dependency with no lock entry, or whose locked commit is not in
the checkout cache, is refused, and the diagnostic names `wac update`.

A build therefore never goes online quietly, and the same lock produces the same program.

`core` and `std` never appear in the lock: their version is the toolchain's
([02](../1-programs/02-modules-and-imports.md)).

A dependency's identity is its repository, its locked commit, and the path within it ([04](../1-programs/04-packages.md)).
