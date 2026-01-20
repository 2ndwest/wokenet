/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as crons from "../crons.js";
import type * as doorStates from "../doorStates.js";
import type * as http from "../http.js";
import type * as loadLocations from "../loadLocations.js";
import type * as locations from "../locations.js";
import type * as shitMyDadSays from "../shitMyDadSays.js";
import type * as users from "../users.js";
import type * as utils_auth from "../utils/auth.js";
import type * as utils_location_labels from "../utils/location_labels.js";
import type * as utils_strings from "../utils/strings.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  doorStates: typeof doorStates;
  http: typeof http;
  loadLocations: typeof loadLocations;
  locations: typeof locations;
  shitMyDadSays: typeof shitMyDadSays;
  users: typeof users;
  "utils/auth": typeof utils_auth;
  "utils/location_labels": typeof utils_location_labels;
  "utils/strings": typeof utils_strings;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
