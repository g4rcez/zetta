import { createAuth } from "@zetta/auth";
import { createDb } from "@zetta/db";

import { ENV, desktopOrigins } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db, desktopOrigins);
