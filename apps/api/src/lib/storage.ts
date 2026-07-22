import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";

export interface PrivateStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  signedGetUrl(key: string, expiresInSeconds: number): Promise<string | null>;
  healthy(): Promise<boolean>;
}

function safeLocalPath(key: string): string {
  if (!/^[A-Za-z0-9/_\-.]+$/.test(key) || key.includes("..")) throw new Error("Chave de armazenamento inválida");
  const root = resolve(process.cwd(), "../../", env.STORAGE_LOCAL_ROOT); const path = resolve(root, key);
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error("Chave fora do armazenamento privado");
  return path;
}

class LocalStorage implements PrivateStorage {
  async put(key: string, data: Buffer): Promise<void> { const path = safeLocalPath(key); await mkdir(dirname(path), { recursive: true }); await writeFile(path, data, { flag: "wx" }); }
  async get(key: string): Promise<Buffer> { return readFile(safeLocalPath(key)); }
  async delete(key: string): Promise<void> { await rm(safeLocalPath(key), { force: true }); }
  async signedGetUrl(): Promise<null> { return null; }
  async healthy(): Promise<boolean> { try { const root = safeLocalPath("health/.keep"); await mkdir(dirname(root), { recursive: true }); return true; } catch { return false; } }
}

class S3Storage implements PrivateStorage {
  private readonly client = new S3Client({ region: env.S3_REGION, ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}), forcePathStyle: env.S3_FORCE_PATH_STYLE, credentials: { accessKeyId: env.S3_ACCESS_KEY!, secretAccessKey: env.S3_SECRET_KEY! } });
  private readonly bucket = env.S3_BUCKET!;
  async put(key: string, data: Buffer, contentType: string): Promise<void> { await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType, ...(env.S3_SERVER_SIDE_ENCRYPTION === "none" ? {} : { ServerSideEncryption: env.S3_SERVER_SIDE_ENCRYPTION }) })); }
  async get(key: string): Promise<Buffer> { const output = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })); if (!output.Body) throw new Error("Objeto não encontrado"); return Buffer.from(await output.Body.transformToByteArray()); }
  async delete(key: string): Promise<void> { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
  async signedGetUrl(key: string, expiresInSeconds: number): Promise<string> { return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresInSeconds }); }
  async healthy(): Promise<boolean> { try { await this.client.send(new HeadBucketCommand({ Bucket: this.bucket })); return true; } catch { return false; } }
}

let storage: PrivateStorage | undefined;
export function getPrivateStorage(): PrivateStorage { storage ??= env.STORAGE_DRIVER === "s3" ? new S3Storage() : new LocalStorage(); return storage; }
