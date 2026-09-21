//src/app/api/WhatsApp/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { whatsappConnections } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * WhatsApp Webhook Verification
 *
 * Meta sends:
 * GET /api/whatsapp/webhook
 *
 * Query parameters:
 * hub.mode
 * hub.verify_token
 * hub.challenge
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const mode = searchParams.get("hub.mode");
    const token = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    const verifyToken =
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim();

    console.log("[WhatsApp Webhook] Mode:", mode);
    console.log(
      "[WhatsApp Webhook] Token received:",
      token ? "YES" : "NO"
    );
    console.log(
      "[WhatsApp Webhook] Token length:",
      token?.length || 0
    );
    console.log(
      "[WhatsApp Webhook] Env token loaded:",
      verifyToken ? "YES" : "NO"
    );
    console.log(
      "[WhatsApp Webhook] Env token length:",
      verifyToken?.length || 0
    );
    console.log(
      "[WhatsApp Webhook] Token match:",
      token === verifyToken
    );

    if (!verifyToken) {
      console.error(
        "[WhatsApp Webhook] WHATSAPP_WEBHOOK_VERIFY_TOKEN is missing"
      );

      return new NextResponse(
        "Webhook verify token not configured",
        {
          status: 500,
          headers: {
            "Content-Type": "text/plain",
          },
        }
      );
    }

    if (
      mode === "subscribe" &&
      token !== null &&
      token === verifyToken
    ) {
      console.log(
        "[WhatsApp Webhook] Verification successful"
      );

      return new NextResponse(challenge || "", {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    console.warn(
      "[WhatsApp Webhook] Verification failed"
    );

    return new NextResponse("Forbidden", {
      status: 403,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  } catch (error) {
    console.error(
      "[WhatsApp Webhook] GET error:",
      error
    );

    return new NextResponse("Internal Server Error", {
      status: 500,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }
}

/**
 * Verify that a POST really came from Meta by checking the
 * X-Hub-Signature-256 header against your App Secret.
 */
function isValidSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();

  if (!appSecret) {
    console.error("[WhatsApp Webhook] WHATSAPP_APP_SECRET is missing");
    return false;
  }

  if (!signatureHeader) {
    console.warn("[WhatsApp Webhook] Missing X-Hub-Signature-256 header");
    return false;
  }

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

/**
 * WhatsApp Incoming Webhook
 *
 * Meta sends:
 * POST /api/whatsapp/webhook
 */
export async function POST(request: NextRequest) {
  try {
    // Read as raw text first so we can verify the signature,
    // then parse it ourselves (request.json() consumes the stream).
    const rawBody = await request.text();
    const signature = request.headers.get("x-hub-signature-256");

    if (!isValidSignature(rawBody, signature)) {
      console.warn("[WhatsApp Webhook] Invalid signature, rejecting");

      return NextResponse.json(
        { success: false, message: "Invalid signature" },
        { status: 401 }
      );
    }

    const body = JSON.parse(rawBody);

    console.log(
      "[WhatsApp Webhook] Incoming event:",
      JSON.stringify(body, null, 2)
    );

    if (body.object !== "whatsapp_business_account") {
      console.warn(
        "[WhatsApp Webhook] Unknown object:",
        body.object
      );

      return NextResponse.json(
        {
          success: false,
          message: "Unknown webhook object",
        },
        { status: 400 }
      );
    }

    for (const entry of body.entry || []) {
      const wabaId = entry.id;

      console.log(
        "[WhatsApp Webhook] WABA ID:",
        wabaId
      );

      for (const change of entry.changes || []) {
        const field = change.field;
        const value = change.value;

        console.log(
          "[WhatsApp Webhook] Field:",
          field
        );

        /*
         * Embedded Signup connection events.
         * These fire when a client finishes connecting their
         * WhatsApp Business Account via Meta-hosted Embedded Signup.
         */
        if (
          field === "account_update" ||
          field === "business_status_update" ||
          field === "account_review_update"
        ) {
          const phoneNumberId = value?.phone_number_id;

          console.log(
            "[WhatsApp Webhook] Account event:",
            field
          );
          console.log(
            "[WhatsApp Webhook] WABA ID:",
            wabaId
          );
          console.log(
            "[WhatsApp Webhook] Phone Number ID:",
            phoneNumberId
          );
          console.log(
            "[WhatsApp Webhook] Account event value:",
            JSON.stringify(value, null, 2)
          );

          if (wabaId) {
            try {
              const businessPhoneNumber: string | undefined =
                value?.display_phone_number ||
                value?.phone_number;

              const businessName: string | undefined =
                value?.verified_name ||
                value?.business_name ||
                value?.name;

              const updateResult = await db
                .update(whatsappConnections)
                .set({
                  ...(phoneNumberId ? { phoneNumberId } : {}),
                  ...(businessPhoneNumber ? { businessPhoneNumber } : {}),
                  ...(businessName ? { businessName } : {}),
                  status: "active",
                  updatedAt: new Date(),
                })
                .where(eq(whatsappConnections.wabaId, wabaId));

              // mysql2 driver result shape via Drizzle: [ResultSetHeader, FieldPacket[]]
              const affectedRows =
                Array.isArray(updateResult) && updateResult[0]
                  ? (updateResult[0] as { affectedRows?: number }).affectedRows
                  : undefined;

              console.log(
                "[WhatsApp Webhook] DB update affectedRows:",
                affectedRows
              );

              // No row for this WABA yet — the row is normally created by
              // POST /api/whatsapp/connect (code -> token exchange), which
              // is the only place that knows the userId. If that hasn't run
              // yet, there's nothing to update here.
              if (!affectedRows) {
                console.warn(
                  "[WhatsApp Webhook] No existing row for WABA ID, skipping:",
                  wabaId
                );
              }
            } catch (dbError) {
              console.error(
                "[WhatsApp Webhook] DB update failed:",
                dbError
              );
            }
          } else {
            console.warn(
              "[WhatsApp Webhook] Account event missing WABA ID, cannot update DB"
            );
          }
        }

        /*
         * WhatsApp messages/statuses
         */
        if (field === "messages") {
          const phoneNumberId =
            value?.metadata?.phone_number_id;

          const displayPhoneNumber =
            value?.metadata?.display_phone_number;

          console.log(
            "[WhatsApp Webhook] Phone Number ID:",
            phoneNumberId
          );

          console.log(
            "[WhatsApp Webhook] Display Number:",
            displayPhoneNumber
          );

          for (const message of value?.messages || []) {
            console.log(
              "[WhatsApp Webhook] Message:",
              JSON.stringify(message, null, 2)
            );

            const from = message.from;
            const messageId = message.id;
            const messageType = message.type;

            console.log(
              "[WhatsApp Webhook] From:",
              from
            );

            console.log(
              "[WhatsApp Webhook] Message ID:",
              messageId
            );

            console.log(
              "[WhatsApp Webhook] Message Type:",
              messageType
            );

            if (messageType === "text") {
              const text =
                message.text?.body || "";

              console.log(
                "[WhatsApp Webhook] Text:",
                text
              );

              /*
               * TODO:
               * Save incoming message to database.
               */
            }
          }

          for (const status of value?.statuses || []) {
            console.log(
              "[WhatsApp Webhook] Status:",
              JSON.stringify(status, null, 2)
            );

            const messageId = status.id;
            const statusValue = status.status;
            const recipientId =
              status.recipient_id;

            console.log(
              "[WhatsApp Webhook] Message status:",
              statusValue
            );

            console.log(
              "[WhatsApp Webhook] Message ID:",
              messageId
            );

            console.log(
              "[WhatsApp Webhook] Recipient:",
              recipientId
            );

            /*
             * TODO:
             * Update message status in database.
             */
          }
        }
      }
    }

    return NextResponse.json(
      {
        success: true,
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    console.error(
      "[WhatsApp Webhook] POST error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error: "Webhook processing failed",
      },
      {
        status: 500,
      }
    );
  }
}