import { useEffect } from 'react';

/**
 * Landing page after OAuth completes inside a popup.
 * Notifies the opener and closes the popup window.
 */
export default function AuthDone() {
  useEffect(() => {
    if (window.opener) {
      window.opener.postMessage({ type: 'auth_complete' }, window.location.origin);
    }
    window.close();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
      Signing you in…
    </div>
  );
}
