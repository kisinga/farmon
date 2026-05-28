/**
 * Google Drive backup operations.
 *
 * Uses raw fetch with OAuth2 access tokens.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { promisify } from "node:util";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

export interface DriveFile {
  id: string;
  name: string;
  createdTime: string;
  mimeType: string;
}

/** Ensure the MajiFlow backup folder exists in Drive. Returns folder ID. */
export async function ensureBackupFolder(accessToken: string): Promise<string> {
  // Search for existing folder
  const search = await fetch(
    `${DRIVE_FILES_URL}?q=${encodeURIComponent("name='MajiFlow' and mimeType='application/vnd.google-apps.folder' and trashed=false")}&spaces=drive`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!search.ok) throw new Error(`Drive search failed: ${search.status}`);
  const searchData = (await search.json()) as { files?: Array<{ id: string }> };
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Create folder
  const create = await fetch(DRIVE_FILES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "MajiFlow",
      mimeType: "application/vnd.google-apps.folder",
    }),
  });

  if (!create.ok) throw new Error(`Drive folder creation failed: ${create.status}`);
  const createData = (await create.json()) as { id: string };
  return createData.id;
}

/** Upload a file to Drive inside the given folder. */
export async function uploadFile(
  accessToken: string,
  folderId: string,
  name: string,
  mimeType: string,
  content: Buffer,
): Promise<string> {
  const metadata = {
    name,
    parents: [folderId],
  };

  const boundary = "----MajiFlowBoundary" + Math.random().toString(36).slice(2);
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const body = Buffer.concat([
    Buffer.from(`${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`),
    Buffer.from(`${delimiter}Content-Type: ${mimeType}\r\n\r\n`),
    content,
    Buffer.from(closeDelimiter),
  ]);

  const res = await fetch(DRIVE_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive upload failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

/** List files in the MajiFlow folder. */
export async function listBackupFiles(accessToken: string, folderId: string): Promise<DriveFile[]> {
  const res = await fetch(
    `${DRIVE_FILES_URL}?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&orderBy=createdTime desc&fields=files(id,name,createdTime,mimeType)`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files ?? [];
}

/** Download a file from Drive. */
export async function downloadFile(accessToken: string, fileId: string): Promise<Buffer> {
  const res = await fetch(
    `${DRIVE_FILES_URL}/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Compress a buffer with gzip. */
export async function compressBuffer(data: Buffer): Promise<Buffer> {
  return gzip(data);
}

/** Decompress a gzip buffer. */
export async function decompressBuffer(data: Buffer): Promise<Buffer> {
  return gunzip(data);
}
