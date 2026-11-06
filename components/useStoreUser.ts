"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";

/**
 * After Clerk sign-in, make sure the viewer has a users row. Convex derives identity from the
 * verified JWT; the client sends nothing about who it is. Returns true once the row exists.
 */
export function useStoreUser(): boolean {
  const { isAuthenticated } = useConvexAuth();
  const { user } = useUser();
  const store = useMutation(api.users.store);
  const [stored, setStored] = useState(false);
  useEffect(() => {
    if (!isAuthenticated) {
      setStored(false);
      return;
    }
    let cancelled = false;
    store()
      .then(() => {
        if (!cancelled) setStored(true);
      })
      .catch(() => {
        if (!cancelled) setStored(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-run when the Clerk user changes (sign out / switch account) or their name changes.
  }, [isAuthenticated, store, user?.id, user?.fullName]);
  return stored;
}
