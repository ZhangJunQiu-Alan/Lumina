import { supabase } from './supabase';
import { getOfficialLibraryDefinition, resolveLibraryGroupSourceType } from './officialLibrary';
import type { OfficialLibraryId } from '../types';

interface GroupWordRow {
  vocabulary_item_id: string;
}

interface SharedWordRow {
  vocabulary_item_id: string;
}

export interface DeleteLibraryGroupResponse {
  deletedGroupId: string;
  deletedWordCount: number;
  removedReviewStateCount: number;
}

export async function deleteLibraryGroup(
  userId: string,
  groupId: string,
): Promise<DeleteLibraryGroupResponse> {
  const { data: group, error: groupError } = await supabase
    .from('learning_groups')
    .select('id, source_type, library_id, group_name')
    .eq('id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (groupError) {
    throw new Error(groupError.message);
  }

  if (!group) {
    throw new Error('这组词不存在，或它不属于你。');
  }

  if (resolveLibraryGroupSourceType(group.source_type, group.library_id, group.group_name) === 'system') {
    throw new Error('系统词库暂时不支持删除。');
  }

  const { data: groupWords, error: groupWordsError } = await supabase
    .from('learning_group_words')
    .select('vocabulary_item_id')
    .eq('learning_group_id', groupId);

  if (groupWordsError) {
    throw new Error(groupWordsError.message);
  }

  const targetWordIds = Array.from(
    new Set(((groupWords ?? []) as GroupWordRow[]).map((row) => row.vocabulary_item_id).filter(Boolean)),
  );

  let removedReviewStateCount = 0;

  if (targetWordIds.length > 0) {
    const { data: sharedWords, error: sharedWordsError } = await supabase
      .from('learning_group_words')
      .select('vocabulary_item_id, learning_groups!inner(user_id)')
      .in('vocabulary_item_id', targetWordIds)
      .neq('learning_group_id', groupId)
      .eq('learning_groups.user_id', userId);

    if (sharedWordsError) {
      throw new Error(sharedWordsError.message);
    }

    const sharedWordIds = new Set(
      ((sharedWords ?? []) as SharedWordRow[]).map((row) => row.vocabulary_item_id).filter(Boolean),
    );
    const orphanWordIds = targetWordIds.filter((wordId) => !sharedWordIds.has(wordId));

    if (orphanWordIds.length > 0) {
      const { error: reviewEventsError } = await supabase
        .from('review_events')
        .delete()
        .eq('user_id', userId)
        .in('vocabulary_item_id', orphanWordIds);

      if (reviewEventsError) {
        throw new Error(reviewEventsError.message);
      }

      const { error: reviewStatesError, count } = await supabase
        .from('review_states')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .in('vocabulary_item_id', orphanWordIds);

      if (reviewStatesError) {
        throw new Error(reviewStatesError.message);
      }

      removedReviewStateCount = count ?? 0;
    }
  }

  const { error: deleteGroupError } = await supabase
    .from('learning_groups')
    .delete()
    .eq('id', groupId)
    .eq('user_id', userId);

  if (deleteGroupError) {
    throw new Error(deleteGroupError.message);
  }

  return {
    deletedGroupId: groupId,
    deletedWordCount: targetWordIds.length,
    removedReviewStateCount,
  };
}

interface LearnedWordRow {
  vocabulary_items: { word: string | null } | { word: string | null }[] | null;
}

interface LearnedReviewStateRow {
  vocabulary_items: { word: string | null } | { word: string | null }[] | null;
}

export async function fetchOfficialLearnedWords(
  userId: string,
  libraryId: OfficialLibraryId,
): Promise<Set<string>> {
  const officialWordSet = new Set(
    getOfficialLibraryDefinition(libraryId).words.map((word) => word.trim().toLowerCase()),
  );
  const [groupResult, reviewStateResult] = await Promise.all([
    supabase
      .from('learning_group_words')
      .select('vocabulary_items!inner(word), learning_groups!inner(user_id, source_type, library_id)')
      .eq('learning_groups.user_id', userId)
      .eq('learning_groups.source_type', 'system')
      .eq('learning_groups.library_id', libraryId),
    supabase
      .from('review_states')
      .select('vocabulary_items!inner(word)')
      .eq('user_id', userId)
      .neq('memory_state', 'new'),
  ]);

  if (groupResult.error) {
    throw new Error(groupResult.error.message);
  }

  if (reviewStateResult.error) {
    throw new Error(reviewStateResult.error.message);
  }

  const result = new Set<string>();
  for (const row of (groupResult.data ?? []) as LearnedWordRow[]) {
    const vocab = Array.isArray(row.vocabulary_items) ? row.vocabulary_items[0] : row.vocabulary_items;
    const word = vocab?.word?.trim().toLowerCase();
    if (word) result.add(word);
  }

  for (const row of (reviewStateResult.data ?? []) as LearnedReviewStateRow[]) {
    const vocab = Array.isArray(row.vocabulary_items) ? row.vocabulary_items[0] : row.vocabulary_items;
    const word = vocab?.word?.trim().toLowerCase();
    if (word && officialWordSet.has(word)) result.add(word);
  }

  return result;
}
