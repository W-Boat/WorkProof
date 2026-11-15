use flate2::{bufread::GzDecoder, write::GzEncoder, Compression};
use std::{borrow::Cow, io::{Read, Write}};

pub const MAX_FILE_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_JSON_BYTES: usize = 64 * 1024 * 1024;

/// Accept original JSON and one gzip member. Reject trailing data.
pub fn decode(bytes: &[u8]) -> Result<Cow<'_, [u8]>, &'static str> {
    if bytes.len() > MAX_FILE_BYTES {
        return Err("PROOF_TOO_LARGE");
    }
    if !bytes.starts_with(&[0x1f, 0x8b]) {
        return Ok(Cow::Borrowed(bytes));
    }

    let mut decoder = GzDecoder::new(bytes);
    let mut plain = Vec::new();
    decoder.by_ref().take(MAX_JSON_BYTES as u64 + 1)
        .read_to_end(&mut plain).map_err(|_| "INVALID_PROOF_COMPRESSION")?;
    if plain.len() > MAX_JSON_BYTES {
        return Err("PROOF_TOO_LARGE");
    }
    if !decoder.get_ref().is_empty() {
        return Err("INVALID_PROOF_COMPRESSION");
    }
    Ok(Cow::Owned(plain))
}

/// Only switch to gzip when the complete certificate becomes smaller.
pub fn encode(json: Vec<u8>, threshold: Option<usize>) -> Result<Vec<u8>, &'static str> {
    if json.len() > MAX_JSON_BYTES {
        return Err("PROOF_TOO_LARGE");
    }
    if threshold.is_some_and(|minimum| json.len() >= minimum) {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
        encoder.write_all(&json).map_err(|_| "PROOF_COMPRESSION_FAILED")?;
        let compressed = encoder.finish().map_err(|_| "PROOF_COMPRESSION_FAILED")?;
        if compressed.len() < json.len() && compressed.len() <= MAX_FILE_BYTES {
            return Ok(compressed);
        }
    }
    if json.len() > MAX_FILE_BYTES {
        return Err("PROOF_TOO_LARGE");
    }
    Ok(json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_preserves_bytes_and_rejects_corruption() {
        let plain = br#"{"workproof":"example"}"#.repeat(1024);
        let packed = encode(plain.clone(), Some(1)).unwrap();
        assert!(packed.len() < plain.len());
        assert_eq!(decode(&packed).unwrap().as_ref(), plain.as_slice());
        assert_eq!(encode(plain.clone(), None).unwrap(), plain);
        assert!(decode(&packed[..packed.len() - 1]).is_err());
        let mut tailed = packed;
        tailed.push(0);
        assert!(decode(&tailed).is_err());
    }
}
