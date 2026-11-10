import * as grpc from "@grpc/grpc-js";

export interface RegisterClientResult {
  success: boolean;
  sessionToken: string;
  error: string;
}

export function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 127) {
    bytes.push((remaining & 127) | 128);
    remaining >>>= 7;
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

export function encodeStringField(tag: number, value: string): Buffer {
  const buf = Buffer.from(value, "utf8");
  const key = (tag << 3) | 2;
  return Buffer.concat([Buffer.from([key]), encodeVarint(buf.length), buf]);
}

export function encodeRegisterClientRequest(daemonSecret: string, clientName: string): Buffer {
  return Buffer.concat([
    encodeStringField(1, daemonSecret),
    encodeStringField(2, clientName),
  ]);
}

export function decodeRegisterClientResponse(buffer: Buffer): RegisterClientResult {
  let offset = 0;
  let success = false;
  let sessionToken = "";
  let error = "";
  while (offset < buffer.length) {
    const key = buffer[offset++];
    const wireType = key & 7;
    const tag = key >> 3;
    if (wireType === 0) {
      let val = 0;
      let shift = 0;
      while (offset < buffer.length) {
        const b = buffer[offset++];
        val |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      if (tag === 1) success = Boolean(val);
    } else if (wireType === 2) {
      let len = 0;
      let shift = 0;
      while (offset < buffer.length) {
        const b = buffer[offset++];
        len |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      const bytes = buffer.subarray(offset, offset + len);
      offset += len;
      if (tag === 2) sessionToken = bytes.toString("utf8");
      if (tag === 3) error = bytes.toString("utf8");
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      break;
    }
  }
  return { success, sessionToken, error };
}

export function requestDaemonSessionToken(
  daemonAddr: string,
  daemonSecret: string,
  clientName = "primeai",
  timeoutMs = 5_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new grpc.Client(daemonAddr, grpc.credentials.createInsecure());
    const payload = encodeRegisterClientRequest(daemonSecret, clientName);
    const deadline = new Date(Date.now() + timeoutMs);
    client.makeUnaryRequest(
      "/astra.ClientAuthService/RegisterClient",
      (buf: Buffer) => buf,
      decodeRegisterClientResponse,
      payload,
      { deadline },
      (err, res) => {
        client.close();
        if (err) {
          reject(err);
          return;
        }
        if (!res || !res.success || !res.sessionToken) {
          reject(new Error(res?.error || "Daemon rejected client registration"));
          return;
        }
        resolve(res.sessionToken);
      }
    );
  });
}
