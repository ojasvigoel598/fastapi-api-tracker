import { describe, it, expect } from "vitest";
import { poolOptionsFromUrl } from "./connection";

describe("poolOptionsFromUrl", () => {
  it("parses host, port, user, password and database from a plain URL", () => {
    const o = poolOptionsFromUrl("mysql://root@127.0.0.1:3306/app");
    expect(o.host).toBe("127.0.0.1");
    expect(o.port).toBe(3306);
    expect(o.user).toBe("root");
    expect(o.password).toBe("");
    expect(o.database).toBe("app");
    expect(o.ssl).toBeUndefined();
  });

  it("honours ssl-mode=REQUIRED (TiDB/Aiven default) instead of ignoring it", () => {
    const o = poolOptionsFromUrl(
      "mysql://user:p%40ss@gateway01.eu-central-1.prod.aws.tidbcloud.com:4000/db?ssl-mode=REQUIRED",
    );
    expect(o.user).toBe("user");
    expect(o.password).toBe("p@ss");
    expect(o.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("maps VERIFY_CA to full CA verification", () => {
    const o = poolOptionsFromUrl("mysql://u@h:3306/d?ssl-mode=VERIFY_CA");
    expect(o.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("disables TLS when ssl-mode=DISABLED", () => {
    const o = poolOptionsFromUrl("mysql://u@h:3306/d?ssl-mode=DISABLED");
    expect(o.ssl).toBeUndefined();
  });

  it("applies connectionLimit for shared/limited instances", () => {
    const o = poolOptionsFromUrl("mysql://u@h:3306/d?ssl-mode=REQUIRED&connectionLimit=3");
    expect(o.connectionLimit).toBe(3);
  });

  it("ignores a non-positive connectionLimit", () => {
    const o = poolOptionsFromUrl("mysql://u@h:3306/d?connectionLimit=0");
    expect(o.connectionLimit).toBeUndefined();
  });

  it("defaults the port to 3306", () => {
    const o = poolOptionsFromUrl("mysql://u@h/d");
    expect(o.port).toBe(3306);
  });
});
