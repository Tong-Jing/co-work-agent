import { describe, expect, it } from "vitest";
import { renderTemplate, coerceTemplateValue } from "../template.js";

describe("renderTemplate", () => {
  it("substitutes known variables", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("substitutes multiple occurrences and variables", () => {
    expect(renderTemplate("{{a}}-{{b}}-{{a}}", { a: "x", b: "y" })).toBe("x-y-x");
  });

  it("renders missing variables as empty string", () => {
    expect(renderTemplate("Hello {{missing}}!", {})).toBe("Hello !");
  });

  it("tolerates whitespace inside the placeholder", () => {
    expect(renderTemplate("{{ name }}", { name: "Ada" })).toBe("Ada");
  });
});

describe("coerceTemplateValue", () => {
  it("parses JSON arrays and objects", () => {
    expect(coerceTemplateValue('["a","b"]')).toEqual(["a", "b"]);
    expect(coerceTemplateValue('{"x":1}')).toEqual({ x: 1 });
  });

  it("parses booleans", () => {
    expect(coerceTemplateValue("true")).toBe(true);
    expect(coerceTemplateValue("false")).toBe(false);
  });

  it("parses numbers", () => {
    expect(coerceTemplateValue("42")).toBe(42);
  });

  it("falls back to the raw string for plain text", () => {
    expect(coerceTemplateValue("hello world")).toBe("hello world");
  });

  it("falls back to the raw string when JSON-like input fails to parse", () => {
    expect(coerceTemplateValue("[not json")).toBe("[not json");
  });
});
