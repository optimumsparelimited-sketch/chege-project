/**
 * Unit tests for upsertUser() in auth.ts
 *
 * Verifies that OIDC claim fields are correctly mapped to the users table
 * columns, covering:
 *   - Google OIDC claims: given_name / family_name → firstName / lastName
 *   - Non-Google provider fallback: first_name / last_name → firstName / lastName
 *   - Profile image: picture (Google) and profile_image_url (other providers)
 *   - Null-safe defaults when optional name claims are absent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @workspace/db before importing the module under test.
// vi.mock is hoisted, so the factory must be self-contained.
// ---------------------------------------------------------------------------
vi.mock('@workspace/db', () => {
  const makeTable = (name: string) =>
    new Proxy({}, { get: (_, prop) => ({ _table: name, _col: String(prop) }) });

  // Capture the last values() call so tests can assert on them.
  const insertValuesCapture: { captured: unknown } = { captured: undefined };

  const mockReturning = vi.fn();
  const mockOnConflictDoUpdate = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

  return {
    db: { insert: mockInsert },
    usersTable: makeTable('users'),
    // expose internals so tests can inspect / reset them
    __mocks: { mockInsert, mockValues, mockOnConflictDoUpdate, mockReturning, insertValuesCapture },
  };
});

// Import after mock registration.
import { db } from '@workspace/db';
import { upsertUser } from '../auth.js';

// ---------------------------------------------------------------------------
// Helper — reset mocks and configure what db.insert().values()…returning()
// should resolve to.
// ---------------------------------------------------------------------------
type AnyMock = ReturnType<typeof vi.fn>;

function getMocks() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).__proto__.constructor.__mocks ??
    // Access via the module mock internals
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(db) as any);
}

function getInsertMocks() {
  const insert = db.insert as AnyMock;
  // db.insert() → { values } → { onConflictDoUpdate } → { returning }
  const values = insert.mock.results[insert.mock.results.length - 1]?.value?.values as AnyMock | undefined;
  const onConflict = values?.mock.results[0]?.value?.onConflictDoUpdate as AnyMock | undefined;
  const returning = onConflict?.mock.results[0]?.value?.returning as AnyMock | undefined;
  return { insert, values, onConflict, returning };
}

function setupDbReturns(user: Record<string, unknown>) {
  // Reset the entire chain each time
  const returning = vi.fn().mockResolvedValue([user]);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  (db.insert as AnyMock).mockReturnValue({ values });
  return { values, onConflictDoUpdate, returning };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('upsertUser — OIDC claim mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Google OIDC — given_name / family_name
  // -------------------------------------------------------------------------
  describe('Google OIDC provider (given_name / family_name)', () => {
    it('maps given_name → firstName and family_name → lastName', async () => {
      const returnedUser = {
        id: 'google-uid-1',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Smith',
        profileImageUrl: 'https://example.com/photo.jpg',
      };
      const { values } = setupDbReturns(returnedUser);

      const claims = {
        sub: 'google-uid-1',
        email: 'alice@example.com',
        given_name: 'Alice',
        family_name: 'Smith',
        picture: 'https://example.com/photo.jpg',
      };

      const result = await upsertUser(claims);

      expect(result).toEqual(returnedUser);

      // Verify the values written to the DB carry the correct field names.
      const inserted = (values as AnyMock).mock.calls[0][0] as Record<string, unknown>;
      expect(inserted.firstName).toBe('Alice');
      expect(inserted.lastName).toBe('Smith');
      expect(inserted.email).toBe('alice@example.com');
      expect(inserted.id).toBe('google-uid-1');
    });

    it('uses picture claim for profileImageUrl when given by Google', async () => {
      const returnedUser = {
        id: 'google-uid-2',
        email: 'bob@example.com',
        firstName: 'Bob',
        lastName: 'Jones',
        profileImageUrl: 'https://lh3.googleusercontent.com/photo.jpg',
      };
      const { values } = setupDbReturns(returnedUser);

      const claims = {
        sub: 'google-uid-2',
        email: 'bob@example.com',
        given_name: 'Bob',
        family_name: 'Jones',
        picture: 'https://lh3.googleusercontent.com/photo.jpg',
      };

      await upsertUser(claims);

      const inserted = (values as AnyMock).mock.calls[0][0] as Record<string, unknown>;
      expect(inserted.profileImageUrl).toBe('https://lh3.googleusercontent.com/photo.jpg');
    });

    it('does NOT use first_name / last_name when given_name / family_name are present', async () => {
      const returnedUser = {
        id: 'google-uid-3',
        email: 'carol@example.com',
        firstName: 'Carol',
        lastName: 'Brown',
        profileImageUrl: null,
      };
      const { values } = setupDbReturns(returnedUser);

      // Both naming conventions present — Google fields should win.
      const claims = {
        sub: 'google-uid-3',
        email: 'carol@example.com',
        given_name: 'Carol',
        family_name: 'Brown',
        first_name: 'WRONG_FIRST',
        last_name: 'WRONG_LAST',
      };

      await upsertUser(claims);

      const inserted = (values as AnyMock).mock.calls[0][0] as Record<string, unknown>;
      expect(inserted.firstName).toBe('Carol');
      expect(inserted.lastName).toBe('Brown');
    });
  });

  // -------------------------------------------------------------------------
  // Non-Google provider — first_name / last_name fallback
  // -------------------------------------------------------------------------
  describe('Non-Google provider fallback (first_name / last_name)', () => {
    it('falls back to first_name → firstName when given_name is absent', async () => {
      const returnedUser = {
        id: 'other-uid-1',
        email: 'dave@example.com',
        firstName: 'Dave',
        lastName: 'Wilson',
        profileImageUrl: null,
      };
      const { values } = setupDbReturns(returnedUser);

      const claims = {
        sub: 'other-uid-1',
        email: 'dave@example.com',
        first_name: 'Dave',
        last_name: 'Wilson',
      };

      await upsertUser(claims);

      const inserted = (values as AnyMock).mock.calls[0][0] as Record<string, unknown>;
      expect(inserted.firstName).toBe('Dave');
      expect(inserted.lastName).toBe('Wilson');
    });

    it('falls back to profile_image_url when picture is absent', async () => {
      const returnedUser = {
        id: 'other-uid-2',
        email: 'eve@example.com',
        firstName: 'Eve',
        lastName: 'Taylor',
        profileImageUrl: 'https://cdn.example.com/eve.png',
      };
      const { values } = setupDbReturns(returnedUser);

      const claims = {
        sub: 'other-uid-2',
        email: 'eve@example.com',
        first_name: 'Eve',
        last_name: 'Taylor',
        profile_image_url: 'https://cdn.example.com/eve.png',
      };

      await upsertUser(claims);

      const inserted = (values as AnyMock).mock.calls[0][0] as Record<string, unknown>;
      expect(inserted.profileImageUrl).toBe('https://cdn.example.com/eve.png');
    });
  });

  // -------------------------------------------------------------------------
  // picture vs profile_image_url precedence
  // -------------------------------------------------------------------------
  describe('picture claim takes precedence over profile_image_url', () => {
    it('uses picture when both picture and profile_image_url are present', async () => {
      const returnedUser = {
        id: 'google-uid-5',
        email: 'grace@example.com',
        firstName: 'Grace',
        lastName: 'Lee',
        profileImageUrl: 'https://lh3.googleusercontent.com/picture.jpg',
      };
      const { values } = setupDbReturns(returnedUser);

      const claims = {
        sub: 'google-uid-5',
        email: 'grace@example.com',
        given_name: 'Grace',
        family_name: 'Lee',
        // Both present — picture should win
        picture: 'https://lh3.googleusercontent.com/picture.jpg',
        profile_image_url: 'https://cdn.example.com/wrong.png',
      };

      await upsertUser(claims);

      const inserted = (values as AnyMock).mock.calls[0][0] as Record<string, unknown>;
      expect(inserted.profileImageUrl).toBe('https://lh3.googleusercontent.com/picture.jpg');
    });

    it('falls back to profile_image_url only when picture is absent', async () => {
      const returnedUser = {
        id: 'other-uid-3',
        email: 'henry@example.com',
        firstName: 'Henry',
        lastName: 'Park',
        profileImageUrl: 'https://cdn.example.com/henry.png',
      };
      const { values } = setupDbReturns(returnedUser);

      const claims = {
        sub: 'other-uid-3',
        email: 'henry@example.com',
        first_name: 'Henry',
        last_name: 'Park',
        // No picture claim; profile_image_url should be used
        profile_image_url: 'https://cdn.example.com/henry.png',
      };

      await upsertUser(claims);

      const inserted = (values as AnyMock).mock.calls[0][0] as Record<string, unknown>;
      expect(inserted.profileImageUrl).toBe('https://cdn.example.com/henry.png');
    });

    it('sets profileImageUrl to null when neither picture nor profile_image_url is present', async () => {
      const returnedUser = {
        id: 'no-image-uid-1',
        email: 'iris@example.com',
        firstName: 'Iris',
        lastName: 'Ng',
        profileImageUrl: null,
      };
      const { values } = setupDbReturns(returnedUser);

      const claims = {
        sub: 'no-image-uid-1',
        email: 'iris@example.com',
        given_name: 'Iris',
        family_name: 'Ng',
        // Neither picture nor profile_image_url
      };

      await upsertUser(claims);

      const inserted = (values as AnyMock).mock.calls[0][0] as Record<string, unknown>;
      expect(inserted.profileImageUrl).toBeNull();
    });

    it('sets profileImageUrl to null when picture is an empty string', async () => {
      const returnedUser = {
        id: 'no-image-uid-2',
        email: 'jack@example.com',
        firstName: 'Jack',
        lastName: 'Ma',
        profileImageUrl: null,
      };
      const { values } = setupDbReturns(returnedUser);

      const claims = {
        sub: 'no-image-uid-2',
        email: 'jack@example.com',
        given_name: 'Jack',
        family_name: 'Ma',
        picture: '',
        profile_image_url: '',
      };

      await upsertUser(claims);

      const inserted = (values as AnyMock).mock.calls[0][0] as Record<string, unknown>;
      expect(inserted.profileImageUrl).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Null/missing claims — safe defaults
  // -------------------------------------------------------------------------
  describe('Missing optional claims default to null', () => {
    it('sets firstName and lastName to null when no name claims are present', async () => {
      const returnedUser = {
        id: 'anon-uid-1',
        email: null,
        firstName: null,
        lastName: null,
        profileImageUrl: null,
      };
      const { values } = setupDbReturns(returnedUser);

      const claims = { sub: 'anon-uid-1' };

      await upsertUser(claims);

      const inserted = (values as AnyMock).mock.calls[0][0] as Record<string, unknown>;
      expect(inserted.firstName).toBeNull();
      expect(inserted.lastName).toBeNull();
      expect(inserted.email).toBeNull();
      expect(inserted.profileImageUrl).toBeNull();
    });

    it('sets firstName to null when given_name is an empty string', async () => {
      const returnedUser = {
        id: 'anon-uid-2',
        email: 'ghost@example.com',
        firstName: null,
        lastName: null,
        profileImageUrl: null,
      };
      const { values } = setupDbReturns(returnedUser);

      // Empty strings should be treated as absent and coerced to null.
      const claims = {
        sub: 'anon-uid-2',
        email: 'ghost@example.com',
        given_name: '',
        family_name: '',
      };

      await upsertUser(claims);

      const inserted = (values as AnyMock).mock.calls[0][0] as Record<string, unknown>;
      expect(inserted.firstName).toBeNull();
      expect(inserted.lastName).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Conflict-update — values passed to onConflictDoUpdate match values()
  // -------------------------------------------------------------------------
  describe('Upsert (onConflictDoUpdate) passes correct data', () => {
    it('passes the same field values to onConflictDoUpdate as to values()', async () => {
      const returnedUser = {
        id: 'google-uid-4',
        email: 'frank@example.com',
        firstName: 'Frank',
        lastName: 'Green',
        profileImageUrl: null,
      };
      const { values, onConflictDoUpdate } = setupDbReturns(returnedUser);

      const claims = {
        sub: 'google-uid-4',
        email: 'frank@example.com',
        given_name: 'Frank',
        family_name: 'Green',
      };

      await upsertUser(claims);

      const insertedValues = (values as AnyMock).mock.calls[0][0] as Record<string, unknown>;
      const { set } = (onConflictDoUpdate as AnyMock).mock.calls[0][0] as { set: Record<string, unknown> };

      expect(set.firstName).toBe(insertedValues.firstName);
      expect(set.lastName).toBe(insertedValues.lastName);
      expect(set.email).toBe(insertedValues.email);
      // updatedAt is added by the upsert path; it should be present.
      expect(set.updatedAt).toBeInstanceOf(Date);
    });
  });
});
