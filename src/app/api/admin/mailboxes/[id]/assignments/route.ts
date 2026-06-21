/**
 * Admin Mailbox — User Assignments (DEPRECATED)
 *
 * This route is no longer used. Mailbox access is now store-scoped
 * via feature authorization, not per-user assignment.
 *
 * UserMailboxAccess rows are retained as deprecated data during migration.
 */
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "User mailbox assignments are deprecated. Access is now store-scoped." },
    { status: 410 },
  );
}

export async function PUT() {
  return NextResponse.json(
    { error: "User mailbox assignments are deprecated. Access is now store-scoped." },
    { status: 410 },
  );
}
