import { renderHook, act } from '@testing-library/react';
import { useUsuarios } from '../useUsuarios';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../../../../services/api';

// Mocks
vi.mock('../../../../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  toPublicAssetUrl: vi.fn((url) => `/public/${url}`),
}));

describe('useUsuarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize and load user on mount', async () => {
    const mockUser = { id: 1, email: 'user@test.com', nome: 'Test User' };
    (api.get as any).mockResolvedValue({ data: mockUser });

    const { result } = renderHook(() => useUsuarios());
    
    expect(result.current.loading).toBe(true);
    
    // Wait for the hook to finish loading
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.loading).toBe(false);
  });

  it('should handle removing user photo', async () => {
    const mockUser = { id: 1, email: 'user@test.com', nome: 'Test User', foto_url: 'photo.jpg' };
    (api.get as any).mockResolvedValue({ data: mockUser });
    (api.delete as any).mockResolvedValue({});

    const { result } = renderHook(() => useUsuarios());

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await result.current.handleRemoveUserPhoto();
    });

    expect(api.delete).toHaveBeenCalledWith('/usuarios/me/foto');
    expect(result.current.user?.foto_url).toBeNull();
  });
});
