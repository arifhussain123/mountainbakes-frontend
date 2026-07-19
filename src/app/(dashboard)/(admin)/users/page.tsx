import { Topbar } from '@/components/layout/Topbar';
import { UsersPage } from '@/components/users/UsersPage';

export default function Page() {
  return (
    <>
      <Topbar title="Users" />
      <div className="p-6">
        <UsersPage />
      </div>
    </>
  );
}
