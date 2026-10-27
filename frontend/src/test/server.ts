import { setupServer } from "msw/node";

/** The mock API. Tests add handlers with `server.use(...)`; unhandled requests fail the test. */
export const server = setupServer();
export const API = "http://api.test/api/v1";
