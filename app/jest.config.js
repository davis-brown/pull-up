/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.jest.json" }],
  },
  testPathIgnorePatterns: ["<rootDir>/node_modules/"],
};
