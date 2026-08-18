/**
 * Check `sigv4()` against AWS's own published test vector.
 *
 *     node scripts/verify-sigv4.mjs
 *
 * **A signature is the one part of the S3 store that cannot be tested by using it.** Everything
 * else fails visibly — a missing bucket 404s, a missing key 404s, a stale ETag 412s and says so.
 * A wrong signature returns 403 `SignatureDoesNotMatch`, which reads as a permissions problem, and
 * the next thing anybody does is go and edit the bucket policy. That is a long way from the fault.
 *
 * So this replays the example AWS documents for "GET Object" in the Signature Version 4 test suite:
 * fixed credentials, a fixed clock and a known-correct answer. The credentials below are AWS's own
 * documentation values and grant nothing.
 *
 * It runs in `preflight`, and needs no network and no bucket.
 */

import { sigv4 } from '../mock-server/store.mjs'

/* AWS's published example — https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html */
const VECTOR = {
  method: 'GET',
  host: 'examplebucket.s3.amazonaws.com',
  path: '/test.txt',
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  /* The SHA-256 of the empty string, which is what a GET carries. */
  payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  amzDate: '20130524T000000Z',
  extra: { range: 'bytes=0-9' },
}

const EXPECTED = 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'

const headers = sigv4(VECTOR)
const signature = /Signature=([0-9a-f]{64})/.exec(headers.authorization)?.[1]

const failures = []

if (signature !== EXPECTED) {
  failures.push(`signature is ${signature}\n    expected ${EXPECTED}`)
}

/* The signed-header list is part of the vector too: signing the right bytes with the wrong list
   still fails, and fails identically. */
const EXPECTED_SIGNED = 'host;range;x-amz-content-sha256;x-amz-date'
const signed = /SignedHeaders=([^,]+)/.exec(headers.authorization)?.[1]
if (signed !== EXPECTED_SIGNED) {
  failures.push(`signed headers are ${signed}\n    expected ${EXPECTED_SIGNED}`)
}

/* A session token must be signed when present — an omitted one is a 403 on any role-based box,
   which is every deployed box. */
const withToken = sigv4({ ...VECTOR, sessionToken: 'FQoGZXIvYXdzEXAMPLETOKEN' })
if (!/SignedHeaders=[^,]*x-amz-security-token/.test(withToken.authorization)) {
  failures.push('a session token is not covered by the signature')
}
if (withToken['x-amz-security-token'] !== 'FQoGZXIvYXdzEXAMPLETOKEN') {
  failures.push('a session token is not sent as a header')
}

if (failures.length > 0) {
  console.error('\nverify-sigv4: FAILED')
  for (const f of failures) console.error(`  · ${f}`)
  console.error('\n  S3 will answer 403 SignatureDoesNotMatch, which reads as a bucket-policy')
  console.error('  problem and is not one. Fix the signing in mock-server/store.mjs.\n')
  process.exit(1)
}

console.log('verify-sigv4: OK — matches the AWS published vector, session token covered.')
