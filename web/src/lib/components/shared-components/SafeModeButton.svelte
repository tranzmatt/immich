<script lang="ts">
  import { IconButton } from '@immich/ui';
  import { mdiEye, mdiEyeOff } from '@mdi/js';

  // Local-only safe mode: the server leaves assets tagged NSFW out of every listing while this
  // cookie is 1 (server/src/utils/safe-mode.ts). app.html turns it on for browsers that never
  // set it. Reloading drops the cached timeline so the change shows everywhere at once.
  const COOKIE = 'immich_safe_mode';
  const enabled = document.cookie.split('; ').includes(`${COOKIE}=1`);
  const label = enabled ? 'Safe mode on: NSFW hidden (click to show)' : 'Safe mode off: NSFW shown (click to hide)';

  const toggle = () => {
    // eslint-disable-next-line unicorn/no-document-cookie -- the server reads it on every request
    document.cookie = `${COOKIE}=${enabled ? 0 : 1}; path=/; max-age=31536000; SameSite=Lax`;
    location.reload();
  };
</script>

<IconButton
  color={enabled ? 'secondary' : 'danger'}
  shape="round"
  variant="ghost"
  size="medium"
  icon={enabled ? mdiEyeOff : mdiEye}
  onclick={toggle}
  title={label}
  aria-label={label}
/>
