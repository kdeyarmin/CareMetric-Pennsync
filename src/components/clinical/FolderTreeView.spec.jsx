import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FolderTreeView from './FolderTreeView';

const folders = [
  {
    id: 'owned',
    name: 'My protocols',
    parent_folder_id: null,
    created_by: 'nurse@example.com',
    is_agency_wide: false,
    color: 'blue',
  },
  {
    id: 'shared',
    name: 'Shared protocols',
    parent_folder_id: null,
    created_by: 'other@example.com',
    is_agency_wide: true,
    color: 'green',
  },
];

const renderTree = (overrides = {}) => {
  const props = {
    folders,
    selectedFolderId: null,
    onSelectFolder: vi.fn(),
    onCreateFolder: vi.fn(),
    onRenameFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
    onChangeColor: vi.fn(),
    canEditFolder: (folder) => folder.id === 'owned',
    templatesCount: {},
    ...overrides,
  };
  render(<FolderTreeView {...props} />);
  return props;
};

describe('FolderTreeView write controls', () => {
  it('shows edit, color, and delete only for folders the caller can mutate', async () => {
    const user = userEvent.setup();
    const props = renderTree();

    expect(screen.getByRole('button', { name: 'Change color for My protocols' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename My protocols' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete My protocols' })).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Change color for Shared protocols' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename Shared protocols' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Shared protocols' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete My protocols' }));
    expect(props.onDeleteFolder).toHaveBeenCalledWith('owned');
  });

  it('fails closed when no folder authority predicate is supplied', () => {
    renderTree({ canEditFolder: undefined });

    expect(screen.queryByRole('button', { name: /^(?:Change color for|Rename|Delete) / }))
      .not.toBeInTheDocument();
  });
});
