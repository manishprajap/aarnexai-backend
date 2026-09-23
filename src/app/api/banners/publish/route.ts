// src/app/api/banners/publish/route.ts

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';

import { db } from '@/db';
import {
  banners,
  instagramConnections,
  facebookConnections,
  whatsappConnections,
  whatsappContacts,
  products,
  socialAccounts,
  bannerPublications,
} from '@/db/schema';

import { eq, and } from 'drizzle-orm';

import {
  getUserIdFromRequest,
  AuthError,
} from '@/lib/auth';

// NOTE: confirm this decrypt function actually exists in your
// facebook-token lib (symmetric counterpart to encryptFacebookToken).
// If your whatsapp access_token is stored encrypted with a different
// helper, swap decryptWhatsappToken below accordingly.
import {
  decryptFacebookToken,
} from '@/lib/facebook-token';

/* =========================================================
   CONFIG
========================================================= */

const META_GRAPH_VERSION =
  process.env.META_GRAPH_VERSION || 'v26.0';

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

const IG_GRAPH_API_BASE =
  `https://graph.instagram.com/${META_GRAPH_VERSION}`;

const FB_GRAPH_API_BASE =
  `https://graph.facebook.com/${META_GRAPH_VERSION}`;

const WA_GRAPH_API_BASE =
  `https://graph.facebook.com/${META_GRAPH_VERSION}`;

const GOOGLE_BUSINESS_API_BASE = 'https://mybusiness.googleapis.com/v4';
const GOOGLE_BUSINESS_ACCOUNT_API_BASE = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const GOOGLE_BUSINESS_INFORMATION_API_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';

const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';

const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT ||
  '/var/www/aarnexai.com/aarnexai-backend/upload';


/* =========================================================
   TYPES
========================================================= */

interface PublishBody {
  bannerId: number | string;
  platforms: string[];
}

interface InstagramContainerResponse {
  id?: string;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

interface InstagramStatusResponse {
  status_code?: string;
  status?: string;
  error_message?: string;
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
}


function getPublicImageUrl(
  imageUrl: string | null | undefined
): string {
  if (!imageUrl) {
    throw new Error('Banner image URL is missing');
  }

  let url = String(imageUrl).trim();

  if (
    url.startsWith('https://') ||
    url.startsWith('http://')
  ) {
    return url;
  }

  if (!url.startsWith('/')) {
    url = `/${url}`;
  }

  return `${PUBLIC_BASE_URL}${url}`;
}


function safeFileName(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}


function getMetaErrorMessage(
  data: any,
  fallback = 'Meta API request failed'
): string {
  return (
    data?.error?.message ||
    data?.error_message ||
    data?.message ||
    fallback
  );
}


// Records that a banner was published somewhere, so the analytics
// endpoint (src/app/api/banners/analytics/route.ts) can look up the
// external post ID later and pull impressions/clicks/reach for it.
// Best-effort — never let a logging failure fail the publish itself.
async function recordBannerPublication(params: {
  bannerId: number | string;
  userId: number;
  platform: string;
  externalId: string;
  permalink?: string | null;
}) {
  const { bannerId, userId, platform, externalId, permalink } = params;

  try {
    await db.insert(bannerPublications).values({
      bannerId: Number(bannerId),
      userId,
      platform,
      externalId,
      permalink: permalink || null,
      publishedAt: new Date(),
    });
  } catch (error) {
    console.error('[Publish] Failed to record bannerPublications row:', {
      bannerId, platform, error,
    });
  }
}


async function verifyPublicImage(imageUrl: string) {
  console.log('[Publish] Checking public image URL:', imageUrl);

  const response = await fetch(imageUrl, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
  });

  const contentType = response.headers.get('content-type');

  console.log('[Publish] Public image check:', {
    status: response.status,
    contentType,
    finalUrl: response.url,
  });

  return { response, contentType };
}


async function createInstagramJpeg(
  originalImageUrl: string,
  bannerId: string | number
): Promise<string> {

  console.log('[Instagram] Downloading source image:', originalImageUrl);

  const response = await fetch(originalImageUrl, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Could not download banner image. HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  const fileName =
    `banner-${safeFileName(String(bannerId))}-instagram-${Date.now()}.jpg`;

  const outputDirectory = path.join(
    UPLOAD_ROOT, 'products', 'banners', 'instagram'
  );

  await fs.mkdir(outputDirectory, { recursive: true });

  const outputPath = path.join(outputDirectory, fileName);

  console.log('[Instagram] Creating JPEG:', outputPath);

  await sharp(inputBuffer)
    .jpeg({ quality: 90, progressive: false })
    .toFile(outputPath);

  const publicUrl =
    `${PUBLIC_BASE_URL}/upload/products/banners/instagram/${fileName}`;

  console.log('[Instagram] Generated public JPEG URL:', publicUrl);

  return publicUrl;
}


async function waitForInstagramContainer(
  containerId: string,
  accessToken: string,
  maxAttempts = 20,
  delayMs = 3000
) {

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {

    const url =
      `${IG_GRAPH_API_BASE}/${containerId}` +
      `?fields=status_code,status,error_message` +
      `&access_token=${encodeURIComponent(accessToken)}`;

    console.log(`[Instagram] Container status check ${attempt}/${maxAttempts}`);

    const response = await fetch(url, { method: 'GET', cache: 'no-store' });
    const data = (await response.json()) as InstagramStatusResponse;

    console.log('[Instagram] Container status:', data);

    if (!response.ok) {
      throw new Error(
        getMetaErrorMessage(data, 'Unable to check Instagram media container')
      );
    }

    const statusCode = String(data.status_code || '').toUpperCase();

    if (statusCode === 'FINISHED') {
      return data;
    }

    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      throw new Error(
        data.error_message ||
        `Instagram media container failed with status ${statusCode}`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error('Instagram media container did not finish processing in time');
}


async function publishToInstagram(params: {
  instagramUserId: string;
  accessToken: string;
  imageUrl: string;
  caption: string;
}) {

  const { instagramUserId, accessToken, imageUrl, caption } = params;

  console.log('[Instagram] Creating media container', { instagramUserId, imageUrl });

  const createUrl = `${IG_GRAPH_API_BASE}/${instagramUserId}/media`;
  const createBody = new URLSearchParams();

  createBody.set('image_url', imageUrl);
  createBody.set('caption', caption || '');
  createBody.set('access_token', accessToken);

  const createResponse = await fetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: createBody.toString(),
  });

  const createData = (await createResponse.json()) as InstagramContainerResponse;

  console.log('[Instagram] Create container response:', createData);

  if (!createResponse.ok || !createData.id) {
    throw new Error(
      getMetaErrorMessage(createData, 'Instagram media container creation failed')
    );
  }

  const containerId = createData.id;

  await waitForInstagramContainer(containerId, accessToken);

  console.log('[Instagram] Publishing container:', containerId);

  const publishUrl = `${IG_GRAPH_API_BASE}/${instagramUserId}/media_publish`;
  const publishBody = new URLSearchParams();

  publishBody.set('creation_id', containerId);
  publishBody.set('access_token', accessToken);

  const publishResponse = await fetch(publishUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: publishBody.toString(),
  });

  const publishData = await publishResponse.json();

  console.log('[Instagram] Publish response:', publishData);

  if (!publishResponse.ok || !publishData.id) {
    throw new Error(
      getMetaErrorMessage(publishData, 'Instagram media publishing failed')
    );
  }

  return { mediaId: publishData.id, containerId };
}


/* =========================================================
   FACEBOOK PUBLISHING
========================================================= */

async function publishToFacebook(params: {
  pageId: string;
  pageAccessToken: string;
  imageUrl: string;
  caption: string;
}) {

  const { pageId, pageAccessToken, imageUrl, caption } = params;

  console.log('[Facebook] Publishing photo to page:', pageId);

  const url = `${FB_GRAPH_API_BASE}/${pageId}/photos`;
  const body = new URLSearchParams();

  body.set('url', imageUrl);
  body.set('caption', caption || '');
  body.set('access_token', pageAccessToken);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json();

  console.log('[Facebook] Publish response:', data);

  if (!response.ok || (!data.id && !data.post_id)) {
    throw new Error(getMetaErrorMessage(data, 'Facebook publishing failed'));
  }

  return {
    photoId: data.id as string,
    postId: (data.post_id as string) || (data.id as string),
  };
}


/* =========================================================
   WHATSAPP PUBLISHING (broadcast image to contact list)
========================================================= */

async function sendWhatsappImage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  imageUrl: string;
  caption: string;
}) {

  const { phoneNumberId, accessToken, to, imageUrl, caption } = params;

  const url = `${WA_GRAPH_API_BASE}/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: {
        link: imageUrl,
        caption: caption || '',
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(getMetaErrorMessage(data, `WhatsApp send failed for ${to}`));
  }

  return data;
}


/**
 * Broadcasts the banner image to every active contact saved by this user.
 *
 * IMPORTANT: WhatsApp Cloud API only allows free-form messages (like an
 * image) within a 24-hour customer service window after the contact last
 * messaged the business. Outside that window, Meta requires an approved
 * message TEMPLATE instead. This function will report per-contact failures
 * (e.g. "re-engagement message" errors) rather than silently succeeding —
 * you may eventually need a template-based fallback for contacts outside
 * the window.
 */
async function publishToWhatsappContacts(params: {
  phoneNumberId: string;
  accessToken: string;
  imageUrl: string;
  caption: string;
  contacts: { phoneNumber: string; name: string | null }[];
}) {

  const { phoneNumberId, accessToken, imageUrl, caption, contacts } = params;

  const sent: string[] = [];
  const failed: { phoneNumber: string; error: string }[] = [];

  for (const contact of contacts) {
    try {
      await sendWhatsappImage({
        phoneNumberId,
        accessToken,
        to: contact.phoneNumber,
        imageUrl,
        caption,
      });

      sent.push(contact.phoneNumber);

    } catch (error: any) {
      console.error(
        '[WhatsApp] Failed to send to', contact.phoneNumber, error
      );

      failed.push({
        phoneNumber: contact.phoneNumber,
        error: error?.message || 'Unknown WhatsApp send error',
      });
    }
  }

  return { sent, failed };
}


/* =========================================================
   GOOGLE BUSINESS PUBLISHING (Business Profile "local post")
========================================================= */

async function publishToGoogleBusiness(params: {
  accountId: string;
  locationId: string;
  accessToken: string;
  imageUrl: string;
  caption: string;
}) {

  const { accountId, locationId, accessToken, imageUrl, caption } = params;

  console.log('[GoogleBusiness] Creating local post', { accountId, locationId });

  const url =
    `${GOOGLE_BUSINESS_API_BASE}/accounts/${accountId}/locations/${locationId}/localPosts`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      languageCode: 'en-US',
      summary: caption,
      topicType: 'STANDARD',
      media: [
        {
          mediaFormat: 'PHOTO',
          sourceUrl: imageUrl,
        },
      ],
    }),
  });

  const data = await response.json();

  console.log('[GoogleBusiness] Publish response:', data);

  if (!response.ok || !data.name) {
    throw new Error(getMetaErrorMessage(data, 'Google Business post failed'));
  }

  // data.name looks like: accounts/{accountId}/locations/{locationId}/localPosts/{postId}
  return {
    postName: data.name as string,
    searchUrl: (data.searchUrl as string) || null,
  };
}


/* =========================================================
   LINKEDIN PUBLISHING (UGC image post — 3 step: register,
   upload binary, then create the post)
========================================================= */

async function registerLinkedInUpload(params: {
  ownerUrn: string; // 'urn:li:organization:12345' or 'urn:li:person:abc'
  accessToken: string;
}) {

  const { ownerUrn, accessToken } = params;

  const response = await fetch(
    `${LINKEDIN_API_BASE}/assets?action=registerUpload`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
          owner: ownerUrn,
          serviceRelationships: [
            {
              relationshipType: 'OWNER',
              identifier: 'urn:li:userGeneratedContent',
            },
          ],
        },
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(getMetaErrorMessage(data, 'LinkedIn upload registration failed'));
  }

  const uploadUrl =
    data?.value?.uploadMechanism?.[
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
    ]?.uploadUrl;

  const asset = data?.value?.asset;

  if (!uploadUrl || !asset) {
    throw new Error('LinkedIn did not return an upload URL for the image');
  }

  return { uploadUrl: uploadUrl as string, asset: asset as string };
}


async function uploadLinkedInImage(params: {
  uploadUrl: string;
  accessToken: string;
  imageUrl: string;
}) {

  const { uploadUrl, accessToken, imageUrl } = params;

  console.log('[LinkedIn] Downloading source image:', imageUrl);

  const imageResponse = await fetch(imageUrl, { method: 'GET', cache: 'no-store' });

  if (!imageResponse.ok) {
    throw new Error(
      `Could not download banner image for LinkedIn. HTTP ${imageResponse.status}`
    );
  }

  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
    },
    body: imageBuffer,
  });

  if (!uploadResponse.ok) {
    throw new Error(`LinkedIn image upload failed. HTTP ${uploadResponse.status}`);
  }
}


async function publishToLinkedIn(params: {
  ownerUrn: string; // 'urn:li:organization:12345' or 'urn:li:person:abc'
  accessToken: string;
  imageUrl: string;
  caption: string;
}) {

  const { ownerUrn, accessToken, imageUrl, caption } = params;

  console.log('[LinkedIn] Registering upload', { ownerUrn });

  const { uploadUrl, asset } = await registerLinkedInUpload({ ownerUrn, accessToken });

  console.log('[LinkedIn] Uploading image asset:', asset);

  await uploadLinkedInImage({ uploadUrl, accessToken, imageUrl });

  console.log('[LinkedIn] Creating UGC post');

  const postResponse = await fetch(`${LINKEDIN_API_BASE}/ugcPosts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: ownerUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: caption || '' },
          shareMediaCategory: 'IMAGE',
          media: [
            {
              status: 'READY',
              media: asset,
            },
          ],
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
      },
    }),
  });

  const postData = await postResponse.json().catch(() => ({}));

  console.log('[LinkedIn] Post response:', postData);

  if (!postResponse.ok) {
    throw new Error(getMetaErrorMessage(postData, 'LinkedIn post failed'));
  }

  // LinkedIn often returns the created post's URN in the x-restli-id
  // response header rather than the JSON body — check both.
  const postId: string =
    postData?.id ||
    postResponse.headers.get('x-restli-id') ||
    asset;

  return { postId };
}


/* =========================================================
   POST /api/banners/publish
========================================================= */

export async function POST(req: NextRequest) {

  try {

    /* AUTHENTICATION */

    let userId: number;

    try {
      userId = getUserIdFromRequest(req);
    } catch (error) {
      if (error instanceof AuthError) {
        return NextResponse.json(
          { success: false, message: error.message },
          { status: 401 }
        );
      }
      throw error;
    }


    /* REQUEST BODY */

    const body = (await req.json()) as PublishBody;
    const bannerId = body?.bannerId;

    const platforms = Array.isArray(body?.platforms) ? body.platforms : [];

    if (!bannerId) {
      return NextResponse.json(
        { success: false, message: 'bannerId is required' },
        { status: 400 }
      );
    }

    if (platforms.length === 0) {
      return NextResponse.json(
        { success: false, message: 'At least one platform is required' },
        { status: 400 }
      );
    }


    /* NORMALIZE PLATFORMS */

    const normalizedPlatforms = platforms.map((platform) =>
      String(platform).toLowerCase().trim()
    );

    const wantsInstagram = normalizedPlatforms.includes('instagram');
    const wantsFacebook = normalizedPlatforms.includes('facebook');
    const wantsWhatsapp = normalizedPlatforms.includes('whatsapp');
    const wantsGoogleBusiness = normalizedPlatforms.includes('google_business');
    const wantsLinkedin = normalizedPlatforms.includes('linkedin');
    const wantsYoutube = normalizedPlatforms.includes('youtube');

    console.log('[Publish] Request:', { userId, bannerId, platforms: normalizedPlatforms });


    /* LOAD BANNER */

    const bannerRows = await db
      .select()
      .from(banners)
      .where(eq(banners.id, Number(bannerId)))
      .limit(1);

    const banner = bannerRows[0];

    if (!banner) {
      return NextResponse.json(
        { success: false, message: 'Banner not found' },
        { status: 404 }
      );
    }

    console.log('[Publish] Banner:', banner);


    /* LOAD PRODUCT */

    let product: any = null;

    if (banner.productId) {
      const productRows = await db
        .select()
        .from(products)
        .where(eq(products.id, banner.productId))
        .limit(1);

      product = productRows[0] || null;
    }


    /* ORIGINAL IMAGE URL */

    const originalImageUrl = getPublicImageUrl(banner.imageUrl);

    console.log('[Publish] DB image URL:', banner.imageUrl);
    console.log('[Publish] FINAL public image URL:', originalImageUrl);


    /* VERIFY ORIGINAL IMAGE — required by every platform, since
       Facebook/Instagram/WhatsApp/Google Business/LinkedIn all fetch
       this URL server-side. */

    const imageCheck = await verifyPublicImage(originalImageUrl);

    if (!imageCheck.response.ok) {
      return NextResponse.json(
        {
          success: false,
          message: 'Banner image is not publicly accessible',
          imageUrl: originalImageUrl,
          imageStatus: imageCheck.response.status,
          contentType: imageCheck.contentType,
        },
        { status: 400 }
      );
    }


    /* PREPARE INSTAGRAM IMAGE (Instagram specifically wants a JPEG) */

    let instagramImageUrl = originalImageUrl;

    if (wantsInstagram) {

      try {
        instagramImageUrl = await createInstagramJpeg(originalImageUrl, bannerId);
      } catch (error: any) {
        console.error('[Instagram] JPEG conversion failed:', error);
        return NextResponse.json(
          {
            success: false,
            message: 'Failed to prepare banner image for Instagram',
            imageUrl: originalImageUrl,
            error: error?.message || 'JPEG conversion failed',
          },
          { status: 500 }
        );
      }

      const jpegCheck = await verifyPublicImage(instagramImageUrl);

      if (!jpegCheck.response.ok) {
        return NextResponse.json(
          {
            success: false,
            message: 'Generated Instagram JPEG is not publicly accessible',
            imageUrl: instagramImageUrl,
            imageStatus: jpegCheck.response.status,
            contentType: jpegCheck.contentType,
          },
          { status: 400 }
        );
      }

      console.log('[Instagram] Generated JPEG is publicly accessible:', {
        url: instagramImageUrl,
        status: jpegCheck.response.status,
        contentType: jpegCheck.contentType,
      });
    }


    /* CAPTION */

    function toStringArray(value: unknown): string[] {
      if (!value) return [];

      if (Array.isArray(value)) {
        return value.map((v) => String(v));
      }

      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) {
            return parsed.map((v) => String(v));
          }
        } catch {
          return [value];
        }
      }

      return [];
    }

    const captionParts: string[] = [];

    if (banner.caption) {
      captionParts.push(String(banner.caption));
    } else if (product?.title) {
      captionParts.push(String(product.title));
    }

    if (product?.description) {
      captionParts.push(String(product.description));
    }

    const hashtagList = toStringArray(product?.hashtags);

    if (hashtagList.length > 0) {
      const hashtagLine = hashtagList
        .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
        .join(' ');

      captionParts.push(hashtagLine);
    }

    const caption =
      captionParts.join('\n\n').trim() || 'Check out this product!';

    console.log('[Publish] Hashtags used:', hashtagList);
    console.log('[Publish] Caption:', caption);


    /* RESULT */

    const results: Record<string, any> = {};


    /* INSTAGRAM */

    if (wantsInstagram) {

      console.log('[Instagram] Looking for connection:', { userId });

      const connectionRows = await db
        .select()
        .from(instagramConnections)
        .where(eq(instagramConnections.userId, userId))
        .limit(1);

      const connection = connectionRows[0];

      console.log('[Instagram] Connection found:', !!connection);

      if (!connection) {
        results.instagram = {
          success: false,
          message: 'Instagram is not connected. Please connect Instagram first.',
          requiresInstagramConnection: true,
        };
      } else {

        const instagramUserId = String(connection.instagramUserId || '').trim();
        const accessToken = String(connection.accessToken || '').trim();

        if (!instagramUserId || !accessToken) {
          results.instagram = {
            success: false,
            message: 'Instagram connection is missing required fields',
          };
        } else {

          try {
            const instagramResult = await publishToInstagram({
              instagramUserId,
              accessToken,
              imageUrl: instagramImageUrl,
              caption,
            });

            results.instagram = {
              success: true,
              mediaId: instagramResult.mediaId,
              containerId: instagramResult.containerId,
              imageUrl: instagramImageUrl,
            };

            await recordBannerPublication({
              bannerId,
              userId,
              platform: 'instagram',
              externalId: instagramResult.mediaId,
            });

          } catch (error: any) {
            console.error('[Instagram] Publishing failed:', error);

            results.instagram = {
              success: false,
              message: error?.message || 'Instagram publishing failed',
              imageUrl: instagramImageUrl,
            };
          }
        }
      }
    }


    /* FACEBOOK */

    if (wantsFacebook) {

      console.log('[Facebook] Looking for connection:', { userId });

      const connectionRows = await db
        .select()
        .from(facebookConnections)
        .where(eq(facebookConnections.userId, userId))
        .limit(1);

      const connection = connectionRows[0];

      console.log('[Facebook] Connection found:', !!connection);

      if (!connection) {
        results.facebook = {
          success: false,
          message: 'Facebook is not connected. Please connect Facebook first.',
          requiresFacebookConnection: true,
        };
      } else if (connection.status !== 'active') {
        results.facebook = {
          success: false,
          message: `Facebook connection status is "${connection.status}". Please reconnect Facebook.`,
        };
      } else {

        const pageId = String(connection.pageId || '').trim();

        let pageAccessToken = '';

        try {
          pageAccessToken = decryptFacebookToken(
            String(connection.accessToken || '')
          );
        } catch (error) {
          console.error('[Facebook] Token decryption failed:', error);
        }

        if (!pageId || !pageAccessToken) {
          results.facebook = {
            success: false,
            message: 'Facebook connection is missing required fields',
          };
        } else {

          try {
            const facebookResult = await publishToFacebook({
              pageId,
              pageAccessToken,
              imageUrl: originalImageUrl,
              caption,
            });

            results.facebook = {
              success: true,
              photoId: facebookResult.photoId,
              postId: facebookResult.postId,
              imageUrl: originalImageUrl,
            };

            await recordBannerPublication({
              bannerId,
              userId,
              platform: 'facebook',
              externalId: facebookResult.postId,
            });

            // Best-effort — don't fail the whole request if this update fails.
            try {
              await db
                .update(facebookConnections)
                .set({
                  lastPublishAt: new Date(),
                  lastError: null,
                })
                .where(eq(facebookConnections.userId, userId));
            } catch (updateError) {
              console.error('[Facebook] Failed to update lastPublishAt:', updateError);
            }

          } catch (error: any) {
            console.error('[Facebook] Publishing failed:', error);

            results.facebook = {
              success: false,
              message: error?.message || 'Facebook publishing failed',
              imageUrl: originalImageUrl,
            };

            try {
              await db
                .update(facebookConnections)
                .set({ lastError: error?.message || 'Facebook publishing failed' })
                .where(eq(facebookConnections.userId, userId));
            } catch (updateError) {
              console.error('[Facebook] Failed to update lastError:', updateError);
            }
          }
        }
      }
    }


    /* WHATSAPP */

    if (wantsWhatsapp) {

      console.log('[WhatsApp] Looking for connection:', { userId });

      const connectionRows = await db
        .select()
        .from(whatsappConnections)
        .where(eq(whatsappConnections.userId, userId))
        .limit(1);

      const connection = connectionRows[0];

      console.log('[WhatsApp] Connection found:', !!connection);

      if (!connection) {
        results.whatsapp = {
          success: false,
          message: 'WhatsApp is not connected. Please connect WhatsApp first.',
          requiresWhatsappConnection: true,
        };
      } else if (connection.status !== 'active') {
        results.whatsapp = {
          success: false,
          message: `WhatsApp connection status is "${connection.status}". Please reconnect WhatsApp.`,
        };
      } else {

        const phoneNumberId = String(connection.phoneNumberId || '').trim();

        // NOTE: confirm whether this token is stored encrypted like Facebook's.
        // If so, swap this for a decrypt call (e.g. decryptWhatsappToken).
        const accessToken = String(connection.accessToken || '').trim();

        if (!phoneNumberId || !accessToken) {
          results.whatsapp = {
            success: false,
            message: 'WhatsApp connection is missing required fields',
          };
        } else {

          const contactRows = await db
            .select({
              phoneNumber: whatsappContacts.phoneNumber,
              name: whatsappContacts.name,
            })
            .from(whatsappContacts)
            .where(
              and(
                eq(whatsappContacts.userId, userId),
                eq(whatsappContacts.isActive, true)
              )
            );

          console.log('[WhatsApp] Active contacts found:', contactRows.length);

          if (contactRows.length === 0) {
            results.whatsapp = {
              success: false,
              message: 'No active WhatsApp contacts found to broadcast to.',
            };
          } else {

            const { sent, failed } = await publishToWhatsappContacts({
              phoneNumberId,
              accessToken,
              imageUrl: originalImageUrl,
              caption,
              contacts: contactRows,
            });

            results.whatsapp = {
              success: sent.length > 0,
              sentCount: sent.length,
              failedCount: failed.length,
              sent,
              failed,
              imageUrl: originalImageUrl,
            };

            // WhatsApp is a broadcast (no single "post"), so there's no
            // externalId to look up insights for later — intentionally
            // not recorded in bannerPublications.
          }
        }
      }
    }


    /* GOOGLE BUSINESS */

    if (wantsGoogleBusiness) {

      console.log('[GoogleBusiness] Looking for connection:', { userId });

      const connection = await getGoogleBusinessConnection(userId);

      console.log('[GoogleBusiness] Connection found:', !!connection);

      if (!connection) {
        results.google_business = {
          success: false,
          message: 'Google Business is not connected. Please connect Google Business first.',
          requiresGoogleBusinessConnection: true,
        };
      } else {
        try {
          const { accountId, locationId, accessToken } = connection;
          if (!accountId || !locationId || !accessToken) {
            throw new Error('Google Business account or location is not configured');
          }

            const gbResult = await publishToGoogleBusiness({
              accountId,
              locationId,
              accessToken,
              imageUrl: originalImageUrl,
              caption,
            });

            results.google_business = {
              success: true,
              postName: gbResult.postName,
              searchUrl: gbResult.searchUrl,
              imageUrl: originalImageUrl,
            };

            await recordBannerPublication({
              bannerId,
              userId,
              platform: 'google_business',
              externalId: gbResult.postName,
              permalink: gbResult.searchUrl,
            });

        } catch (error: any) {
          console.error('[GoogleBusiness] Publishing failed:', error);

          results.google_business = {
            success: false,
            message: error?.message || 'Google Business publishing failed',
            imageUrl: originalImageUrl,
          };
        }
      }
    }


    /* LINKEDIN */

    if (wantsLinkedin) {

      console.log('[LinkedIn] Looking for connection:', { userId });

      const connectionRows = await db
        .select()
        .from(socialAccounts)
        .where(and(eq(socialAccounts.userId, userId), eq(socialAccounts.provider, 'linkedin')))
        .limit(1);

      const connection = connectionRows[0];

      console.log('[LinkedIn] Connection found:', !!connection);

      if (!connection) {
        results.linkedin = {
          success: false,
          message: 'LinkedIn is not connected. Please connect LinkedIn first.',
          requiresLinkedinConnection: true,
        };
      } else {

        // Expect either an organization page urn (posting as the
        // business) or a person urn (posting as the connected member).
        // Adjust the column name to whatever you store this under.
        const ownerUrn = String(
          connection.providerAccountId || ''
        ).trim();

        const accessToken = String(connection.accessToken || '').trim();

        if (!ownerUrn || !accessToken) {
          results.linkedin = {
            success: false,
            message: 'LinkedIn connection is missing required fields',
          };
        } else {

          try {
            const linkedinResult = await publishToLinkedIn({
              ownerUrn,
              accessToken,
              imageUrl: originalImageUrl,
              caption,
            });

            results.linkedin = {
              success: true,
              postId: linkedinResult.postId,
              imageUrl: originalImageUrl,
            };

            await recordBannerPublication({
              bannerId,
              userId,
              platform: 'linkedin',
              externalId: linkedinResult.postId,
            });

          } catch (error: any) {
            console.error('[LinkedIn] Publishing failed:', error);

            results.linkedin = {
              success: false,
              message: error?.message || 'LinkedIn publishing failed',
              imageUrl: originalImageUrl,
            };
          }
        }
      }
    }


    /* YOUTUBE */

    if (wantsYoutube) {

      // IMPORTANT: the YouTube Data API has no public endpoint for
      // posting a static image as a feed / "Community" post — Community
      // posts can only be created from YouTube Studio / the app, not
      // via the API. The only thing the API lets you publish is a
      // VIDEO (videos.insert), which a marketing banner image isn't.
      //
      // Rather than silently doing nothing or faking success, this
      // reports back clearly so the UI can tell the user. If/when you
      // want YouTube support, the realistic options are:
      //   1. Render the banner as a short video (e.g. Ken Burns pan)
      //      and upload that with videos.insert, or
      //   2. Drop YouTube from the "post a banner" flow entirely and
      //      keep the connection around for analytics only.
      console.log('[YouTube] Publish requested but not supported by the public API');

      const connectionRows = await db
        .select()
        .from(socialAccounts)
        .where(and(eq(socialAccounts.userId, userId), eq(socialAccounts.provider, 'youtube')))
        .limit(1);

      const connection = connectionRows[0];

      results.youtube = {
        success: false,
        message: connection
          ? "YouTube doesn't support publishing a static image as a public post via the API. YouTube is connected for analytics only."
          : 'YouTube is not connected.',
        supported: false,
      };
    }


    /* FINAL STATUS */

    const successfulPlatforms = Object.entries(results)
      .filter(([, result]) => result?.success === true)
      .map(([platform]) => platform);

    const failedPlatforms = Object.entries(results)
      .filter(([, result]) => result?.success !== true)
      .map(([platform]) => platform);

    if (successfulPlatforms.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: 'No platform was successfully published',
          bannerId,
          results,
        },
        { status: 400 }
      );
    }


    /* MARK BANNER(S) AS POSTED */

    try {
      await db
        .update(banners)
        .set({ posted: true })
        .where(
          and(
            eq(banners.productId, banner.productId),
            eq(banners.day, banner.day)
          )
        );

      console.log('[Publish] Marked banners as posted:', {
        productId: banner.productId,
        day: banner.day,
      });
    } catch (error) {
      console.error('[Publish] Failed to mark banners as posted:', error);
    }


    /* SUCCESS */

    return NextResponse.json(
      {
        success: failedPlatforms.length === 0,
        message:
          failedPlatforms.length === 0
            ? 'Banner published successfully'
            : 'Banner partially published',
        bannerId,
        publishedPlatforms: successfulPlatforms,
        failedPlatforms,
        results,
      },
      { status: failedPlatforms.length === 0 ? 200 : 207 }
    );

  } catch (error: any) {

    console.error('[Publish] Unexpected error:', error);

    return NextResponse.json(
      {
        success: false,
        message: error?.message || 'Failed to publish banner',
        error:
          process.env.NODE_ENV === 'development'
            ? String(error?.stack || error)
            : undefined,
      },
      { status: 500 }
    );
  }
}

async function getGoogleBusinessConnection(userId: number) {
  const [connection] = await db
    .select({
      accessToken: socialAccounts.accessToken,
      refreshToken: socialAccounts.refreshToken,
      expiresAt: socialAccounts.expiresAt,
    })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.userId, userId),
        eq(socialAccounts.provider, 'google_business')
      )
    )
    .limit(1);

  if (!connection?.accessToken) return null;

  let accessToken = connection.accessToken;
  if (connection.expiresAt && connection.expiresAt.getTime() <= Date.now() + 60_000) {
    if (!connection.refreshToken || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new Error('Google Business access token has expired. Please reconnect Google Business.');
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: connection.refreshToken,
        grant_type: 'refresh_token',
      }),
      cache: 'no-store',
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(getMetaErrorMessage(tokenData, 'Unable to refresh Google Business access token'));
    }

    accessToken = tokenData.access_token;
    await db
      .update(socialAccounts)
      .set({
        accessToken,
        expiresAt: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null,
      })
      .where(
        and(
          eq(socialAccounts.userId, userId),
          eq(socialAccounts.provider, 'google_business')
        )
      );
  }

  const accountsResponse = await fetch(`${GOOGLE_BUSINESS_ACCOUNT_API_BASE}/accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  const accountsData = await accountsResponse.json();
  if (!accountsResponse.ok || !accountsData.accounts?.[0]?.name) {
    throw new Error(
      getMetaErrorMessage(
        accountsData,
        'No Google Business Profile account is available for this Google user. Ensure the account has a verified Business Profile and the business.manage scope.'
      )
    );
  }

  const accountName = accountsData.accounts[0].name as string;
  const accountId = accountName.replace(/^accounts\//, '').trim();
  const locationsResponse = await fetch(
    `${GOOGLE_BUSINESS_INFORMATION_API_BASE}/${accountName}/locations?pageSize=100`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' }
  );
  const locationsData = await locationsResponse.json();
  if (!locationsResponse.ok || !locationsData.locations?.[0]?.name) {
    throw new Error(
      getMetaErrorMessage(
        locationsData,
        'No Google Business location was found for this account. Verify the location in Google Business Profile and reconnect Google Business.'
      )
    );
  }

  const locationName = locationsData.locations[0].name as string;
  const locationId = locationName.replace(/^accounts\/[^/]+\/locations\//, '').trim();
  if (!accountId || !locationId) {
    throw new Error('Google Business returned an invalid account or location identifier');
  }

  return {
    accessToken,
    accountId,
    locationId,
  };
}