// Convex verifies the Clerk JWT (minted by the Clerk "convex" JWT template, which
// ConvexProviderWithClerk requests) against this issuer. Set it per deployment:
//   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-clerk-frontend-api>
// The Convex CLI refuses to push until it is set. A wrong issuer fails closed: tokens do not
// verify, so every viewer is signed out (public list only, all signed-in functions refuse).
const authConfig = {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
