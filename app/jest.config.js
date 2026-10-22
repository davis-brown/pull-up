/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  // ts-jest type-checks in every worker; one per core exhausts a small box.
  maxWorkers: "50%",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.jest.json" }],
  },
  testPathIgnorePatterns: ["<rootDir>/node_modules/"],
};
