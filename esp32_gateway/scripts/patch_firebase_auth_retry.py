Import("env")

from pathlib import Path


environment = env.subst("$PIOENV")
libraries = Path(env.subst("$PROJECT_LIBDEPS_DIR")) / environment
matches = list(libraries.glob("*Firebase*Client*/src/core/FirebaseCore.cpp"))
if len(matches) != 1:
    raise RuntimeError(
        "Expected exactly one Firebase Arduino Client dependency; found "
        f"{len(matches)} in {libraries}"
    )

core_file = matches[0]
library_root = core_file.parents[2]
metadata = (library_root / "library.json").read_text(encoding="utf-8")
if '"version": "4.4.17"' not in metadata:
    raise RuntimeError("Firebase auth retry patch was reviewed for version 4.4.17 only")

source = core_file.read_text(encoding="utf-8")
anchor = """            ret = getIdToken(false, toStringPtr(_EMPTY_STR), toStringPtr(_EMPTY_STR));

            // send error cb
"""
replacement = """            ret = getIdToken(false, toStringPtr(_EMPTY_STR), toStringPtr(_EMPTY_STR));

            // Stop the token task on rejected credentials or a temporary Auth lockout.
            // The next request is throttled by config.signer.reqTO in readyToRequest().
            if (!ret && config->signer.tokens.status == token_status_error)
                break;

            // send error cb
"""

if replacement in source:
    print("Firebase auth retry backoff patch already applied")
elif anchor in source:
    core_file.write_text(source.replace(anchor, replacement, 1), encoding="utf-8")
    print("Applied Firebase auth retry backoff patch")
else:
    raise RuntimeError("Firebase token-processing code changed; refusing an unreviewed patch")
