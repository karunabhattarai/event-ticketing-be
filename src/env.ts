function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  organizerJwtSecret: required('ORGANIZER_JWT_SECRET'),
  buyerJwtSecret: required('BUYER_JWT_SECRET'),
  ticketSecret: required('TICKET_SECRET'),
  appBaseUrl: required('APP_BASE_URL'), // frontend origin — CORS allow-list, final browser-redirect target
  backendBaseUrl: required('BACKEND_BASE_URL'), // this server's own public URL — used for Fonepay's callback target, never the frontend origin
  fonepay: {
    merchantCode: process.env.FONEPAY_MERCHANT_CODE ?? '',
    secretKey: process.env.FONEPAY_SECRET_KEY ?? '',
    baseUrl: process.env.FONEPAY_BASE_URL ?? '',
    qrUsername: process.env.FONEPAY_QR_USERNAME ?? '',
    qrPassword: process.env.FONEPAY_QR_PASSWORD ?? '',
    qrBaseUrl: process.env.FONEPAY_QR_BASE_URL ?? '',
  },
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? '',
  },
  orderExpiryMinutes: Number(process.env.ORDER_EXPIRY_MINUTES ?? 15),
  cronSecret: required('CRON_SECRET'),
};

if (env.nodeEnv === 'production') {
  const requiredInProd: [string, string][] = [
    ['FONEPAY_MERCHANT_CODE', env.fonepay.merchantCode],
    ['FONEPAY_SECRET_KEY', env.fonepay.secretKey],
    ['FONEPAY_QR_USERNAME', env.fonepay.qrUsername],
    ['FONEPAY_QR_PASSWORD', env.fonepay.qrPassword],
    ['SMTP_HOST', env.smtp.host],
    ['SMTP_USER', env.smtp.user],
    ['SMTP_PASS', env.smtp.pass],
    ['SMTP_FROM', env.smtp.from],
  ];
  const missing = requiredInProd.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing required production env vars: ${missing.join(', ')}`);
  }
}
