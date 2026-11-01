# Range traits

[![Build](https://img.shields.io/github/actions/workflow/status/timothee-haudebourg/range-traits/ci.yml?branch=main&style=flat-square)](https://github.com/timothee-haudebourg/range-traits/actions)
[![Crate informations](https://img.shields.io/crates/v/range-traits.svg?style=flat-square)](https://crates.io/crates/range-traits)
[![License](https://img.shields.io/crates/l/range-traits.svg?style=flat-square)](https://github.com/timothee-haudebourg/range-traits#license)
[![Documentation](https://img.shields.io/badge/docs-latest-blue.svg?style=flat-square)](https://docs.rs/range-traits)

This library provides utility traits for data types that can be used
to define ranges of values. Default implementations exists for
primitive numeric types and `char`.
The defined traits can help define basic tasks on ranges such as
enumerating the elements of the range (`PartialEnum`),
measure the size of the range (`Measure`), etc.

Its primary use is through the [`btree-range-map`](https://crates.io/crates/btree-range-map) crate
that define data-structures indexed by ranges.
By implementing the traits defined in here, one can extend the type of
ranges supported by `btree-range-map`, without necessarily depending on it.

## License

Licensed under either of

 * Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
 * MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any
additional terms or conditions.
