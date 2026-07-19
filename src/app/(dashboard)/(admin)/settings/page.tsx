import { Topbar } from '@/components/layout/Topbar';
import { SettingsPage } from '@/components/settings/SettingsPage';

export default function Page() {
  return (
    <>
      <Topbar title="Settings" />
      <div className="p-6">
        <SettingsPage />
      </div>
    </>
  );
}
