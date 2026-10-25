import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { IDLE_LIMIT_MS, IdleSignOut, WARNING_MS } from '../IdleSignOut';

/**
 * Phones and tablets sign out after three minutes untouched; any touch, key,
 * typing or scroll — or a save still on its way — keeps the session; desktops
 * are never signed out by this.
 */

const logout = vi.fn(async () => {});
const replace = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ token: 't', logout }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('sonner', () => ({ toast: { info: vi.fn() } }));

let touch = true;
let queryClient: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));
  touch = true;
  window.matchMedia = ((q: string) => ({ matches: touch && q.includes('pointer: coarse'), media: q })) as never;
  window.localStorage.clear();
  logout.mockClear();
  replace.mockClear();
  vi.mocked(toast.info).mockClear();
  queryClient = new QueryClient();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const mount = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <IdleSignOut />
    </QueryClientProvider>,
  );
const wait = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

describe('IdleSignOut', () => {
  test('three minutes untouched on a phone signs out and goes to the login page', async () => {
    mount();
    await wait(IDLE_LIMIT_MS - 2_000);
    expect(logout).not.toHaveBeenCalled();
    await wait(3_000);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/login');
    expect(toast.info).toHaveBeenCalledWith('Signed out after 3 minutes without activity.');
  });

  test('a countdown shows for the last 30 seconds, and a touch keeps the session', async () => {
    mount();
    await wait(IDLE_LIMIT_MS - WARNING_MS + 1_000);
    expect(screen.getByRole('alert').textContent).toMatch(/Signing out in \d+s/);
    fireEvent.pointerDown(window);
    await wait(1_000);
    expect(screen.queryByRole('alert')).toBeNull();
    await wait(IDLE_LIMIT_MS - 5_000);
    expect(logout).not.toHaveBeenCalled();
  });

  test('typing, scrolling and taps all count as activity', async () => {
    mount();
    for (const fire of [
      () => fireEvent.keyDown(window, { key: 'a' }),
      () => fireEvent.scroll(window),
      () => fireEvent.touchStart(window),
      () => fireEvent.input(window),
    ]) {
      await wait(IDLE_LIMIT_MS - 10_000);
      fire();
    }
    await wait(IDLE_LIMIT_MS - 10_000);
    expect(logout).not.toHaveBeenCalled();
  });

  test('a sale or order still saving is never cut off', async () => {
    const spy = vi.spyOn(queryClient, 'isMutating').mockReturnValue(1);
    mount();
    await wait(IDLE_LIMIT_MS * 2);
    expect(logout).not.toHaveBeenCalled();
    spy.mockReturnValue(0);
    await wait(IDLE_LIMIT_MS + 1_000);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  test('activity in another tab keeps this one signed in', async () => {
    mount();
    await wait(IDLE_LIMIT_MS - 10_000);
    window.localStorage.setItem('mb.lastActivityAt', String(Date.now()));
    await wait(IDLE_LIMIT_MS - 10_000);
    expect(logout).not.toHaveBeenCalled();
  });

  test('back from the background after more than three minutes: signed out at once', async () => {
    mount();
    // A sleeping phone runs no timers: move the clock without ticking.
    vi.setSystemTime(Date.now() + IDLE_LIMIT_MS + 60_000);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  test('a re-render or token refresh does not restart the clock', async () => {
    const view = mount();
    await wait(IDLE_LIMIT_MS - 60_000);
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <IdleSignOut />
      </QueryClientProvider>,
    );
    await wait(61_000);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  test('a desktop or till PC is never signed out by this', async () => {
    touch = false;
    mount();
    await wait(IDLE_LIMIT_MS * 3);
    expect(logout).not.toHaveBeenCalled();
  });
});
