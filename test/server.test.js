const test = require("node:test");
const assert = require("node:assert/strict");
const { validateFigure, normalizeFigure } = require("../src/server");

test("validates and normalizes screenshot-shaped records", () => {
  const figure = {
    popNumber: "06",
    name: " Peggy Schuyler ",
    releaseYear: 2021,
    category: "Broadway",
    franchise: "Hamilton"
  };
  assert.equal(validateFigure(figure), null);
  assert.deepEqual(normalizeFigure(figure), { ...figure, name: "Peggy Schuyler" });
});

test("rejects malformed pop numbers", () => {
  assert.equal(
    validateFigure({ popNumber: "A6", name: "Example", releaseYear: 2021, category: "X", franchise: "Y" }),
    "popNumber must contain digits only"
  );
});

test("validates and normalizes an image URL", () => {
  const figure = {
    popNumber: "898",
    name: "President Loki",
    releaseYear: 2021,
    category: "Marvel",
    franchise: "Loki",
    imageUrl: " https://example.com/loki.png "
  };
  assert.equal(validateFigure(figure), null);
  assert.equal(normalizeFigure(figure).imageUrl, "https://example.com/loki.png");
});

test("rejects non-http image URLs", () => {
  assert.equal(
    validateFigure({
      popNumber: "898",
      name: "President Loki",
      releaseYear: 2021,
      category: "Marvel",
      franchise: "Loki",
      imageUrl: "javascript:alert(1)"
    }),
    "imageUrl must use http or https"
  );
});

test("validates and normalizes prices", () => {
  const figure = {
    popNumber: "898",
    name: "President Loki",
    releaseYear: 2021,
    category: "Marvel",
    franchise: "Loki",
    retailPrice: 14.99,
    resalePrice: 35
  };
  assert.equal(validateFigure(figure), null);
  assert.equal(normalizeFigure(figure).resalePrice, 35);
});
