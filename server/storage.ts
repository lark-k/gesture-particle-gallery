import OSS from "ali-oss";
import type { Config } from "./config";
export interface UploadGrant {
  host: string;
  fields: Record<string, string>;
  expiresAt: number;
}
export interface Storage {
  grant(key: string, mime: string, size: number): UploadGrant;
  head(key: string): Promise<{ size: number; mime: string }>;
  get(key: string): Promise<Buffer>;
  put(key: string, data: Buffer, mime: string): Promise<void>;
  delete(key: string): Promise<void>;
  read(key: string, size?: number): string | Promise<string>;
}
export function uploadPolicy(
  key: string,
  mime: string,
  size: number,
  bucket: string,
  expiresAt: number,
  token = "",
) {
  const conditions: unknown[] = [
    { bucket },
    ["eq", "$key", key],
    ["eq", "$Content-Type", mime],
    ["content-length-range", size, size],
    ["eq", "$success_action_status", "200"],
  ];
  if (token) conditions.push({ "x-oss-security-token": token });
  return { expiration: new Date(expiresAt).toISOString(), conditions };
}
export class OSSStorage implements Storage {
  private client: OSS;
  constructor(private config: Config) {
    this.client = new OSS({
      region: config.region,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      stsToken: config.stsToken || undefined,
      secure: true,
      authorizationV4: true,
      timeout: 45000,
    });
  }
  grant(key: string, mime: string, size: number) {
    const expiresAt = Date.now() + 120000;
    const policy = uploadPolicy(
      key,
      mime,
      size,
      this.config.bucket,
      expiresAt,
      this.config.stsToken,
    );
    const date = new Date();
    const timestamp = date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    const credential = `${this.config.accessKeyId}/${timestamp.slice(0, 8)}/${this.config.region.replace(/^oss-/, "")}/oss/aliyun_v4_request`;
    policy.conditions.push(
      { "x-oss-signature-version": "OSS4-HMAC-SHA256" },
      { "x-oss-credential": credential },
      { "x-oss-date": timestamp },
    );
    // ali-oss 6.23.0 exposes this official method; DefinitelyTyped has not added it yet.
    const signer = this.client as OSS & {
      signPostObjectPolicyV4(
        policy: ReturnType<typeof uploadPolicy>,
        date: Date,
      ): string;
    };
    const signature = signer.signPostObjectPolicyV4(policy, date);
    return {
      host: `https://${this.config.bucket}.${this.config.region}.aliyuncs.com`,
      expiresAt,
      fields: {
        key,
        "Content-Type": mime,
        success_action_status: "200",
        "x-oss-signature-version": "OSS4-HMAC-SHA256",
        "x-oss-credential": credential,
        "x-oss-date": timestamp,
        "x-oss-signature": signature,
        policy: Buffer.from(JSON.stringify(policy)).toString("base64"),
        ...(this.config.stsToken
          ? { "x-oss-security-token": this.config.stsToken }
          : {}),
      },
    };
  }
  async head(key: string) {
    const r = await this.client.head(key);
    const headers = r.res.headers as Record<string, string>;
    return {
      size: Number(headers["content-length"]),
      mime: String(headers["content-type"]).split(";")[0],
    };
  }
  async get(key: string) {
    return (await this.client.get(key)).content as Buffer;
  }
  async put(key: string, data: Buffer, mime: string) {
    await this.client.put(key, data, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=900",
        "x-oss-object-acl": "private",
      },
    });
  }
  async delete(key: string) {
    await this.client.delete(key);
  }
  read(key: string, size?: number) {
    return this.client.signatureUrlV4(
      "GET",
      900,
      size
        ? {
            queries: {
              "x-oss-process": `image/resize,m_lfit,w_${size},h_${size}/auto-orient,1`,
            },
          }
        : undefined,
      key,
    );
  }
}
