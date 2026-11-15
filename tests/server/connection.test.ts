import { describe, expect, it } from "vitest";

import { connectionPlan } from "../../server/db/client";

describe("connectionPlan", () => {
  it("verifies first and only then relaxes when the URL says sslmode=require", () => {
    expect(connectionPlan("postgres://u:p@db.example.com/app?sslmode=require")).toEqual({
      preferred: "postgres://u:p@db.example.com/app?sslmode=verify-full",
      fallback: "postgres://u:p@db.example.com/app?sslmode=require&uselibpqcompat=true",
    });
  });

  it("keeps the other query parameters wherever sslmode sits", () => {
    expect(connectionPlan("postgres://u:p@h:6543/db?sslmode=require&supa=base-pooler.x")).toEqual({
      preferred: "postgres://u:p@h:6543/db?sslmode=verify-full&supa=base-pooler.x",
      fallback: "postgres://u:p@h:6543/db?sslmode=require&uselibpqcompat=true&supa=base-pooler.x",
    });
    expect(connectionPlan("postgres://u:p@h/db?channel_binding=require&sslmode=require")).toEqual({
      preferred: "postgres://u:p@h/db?channel_binding=require&sslmode=verify-full",
      fallback: "postgres://u:p@h/db?channel_binding=require&sslmode=require&uselibpqcompat=true",
    });
  });

  it.each([
    "postgres://u:p@localhost:5432/app",
    "postgres://u:p@h/app?sslmode=disable",
    "postgres://u:p@h/app?sslmode=verify-full",
    "postgres://u:p@h/app?sslmode=no-verify",
    "postgres://u:p@h/app?sslmode=required",
    "postgres://u:p@h/app?uselibpqcompat=true&sslmode=require",
    "postgres://u:sslmode=require@h/app",
  ])("leaves %s exactly as written", (url) => {
    expect(connectionPlan(url)).toEqual({ preferred: url, fallback: null });
  });
});
