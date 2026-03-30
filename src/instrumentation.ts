/**
 * Next.js Instrumentation — OpenTelemetry + Braintrust
 *
 * Sends traces to Braintrust via Vercel's OTel integration.
 * Only activates on the Node.js runtime (not Edge).
 */

import { registerOTel } from '@vercel/otel';

export function register() {
  registerOTel({
    serviceName: 'quoth-mcp',
  });
}
