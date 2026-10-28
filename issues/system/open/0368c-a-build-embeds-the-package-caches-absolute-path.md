# 0368c — a build embeds the package cache's absolute path, so the same lock gives different programs

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-10-28
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

`templates/webapp/`, its dependencies fetched once and the cache copied so both homes hold the same
bytes:

    cp -r templates/webapp app && cd app
    WAC_HOME=$PWD/../home1 wac update
    cp -r ../home1 ../home-two
    WAC_HOME=$PWD/../home1    wac build src/app.wac -o ../out-home1      # 2106808 bytes
    WAC_HOME=$PWD/../home-two wac build src/app.wac -o ../out-home-two   # 2110840 bytes

Expected: byte-identical modules. spec ch46 says *"the same lock produces the same program"*.
Actual: they differ from byte 157,856, and the names carry the home directory:

    …_repro_home_two_cache_git_https_3A_2F_2Fgithub_com_2Fvoltrevo_2Fwac_a66fe9d5…_packages_web_src_page_new

## Notes

A dependency's symbols are prefixed with the path of its checkout in the cache, and that path is
absolute. So a build is not reproducible across machines or users, and every published page carries
its builder's home path. A dependency's identity is its repository, commit and path within it (ch04
`§wac-package-identity-uskz3mi`), and that is the prefix it should have.

Reported by the agent that built the archive explorer, which saw it as a page that differed between
machines. Where the prefix is made is not located yet.
