import { supabaseAdmin } from './supabase.js';

interface GroupWordRow {
  vocabulary_item_id: string;
}

interface SharedWordRow {
  vocabulary_item_id: string;
}

const OFFICIAL_GROUP_PATTERN = /^雅思词汇真经 · \d{4}-\d{4}$/;

function isSystemLibraryGroup(sourceType: string | null, groupName: string | null) {
  return sourceType === 'system' || OFFICIAL_GROUP_PATTERN.test(groupName ?? '');
}

export interface DeleteLearningGroupResult {
  deletedGroupId: string;
  deletedWordCount: number;
  removedReviewStateCount: number;
}

export async function deleteLearningGroup(userId: string, groupId: string): Promise<DeleteLearningGroupResult> {
  const { data: group, error: groupError } = await supabaseAdmin
    .from('learning_groups')
    .select('id, source_type, group_name')
    .eq('id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (groupError) {
    throw new Error(`learning_groups lookup failed: ${groupError.message}`);
  }

  if (!group) {
    throw new Error('这组词不存在，或它不属于你。');
  }

  if (isSystemLibraryGroup(group.source_type, group.group_name)) {
    throw new Error('系统词库暂时不支持删除。');
  }

  const { data: groupWords, error: groupWordsError } = await supabaseAdmin
    .from('learning_group_words')
    .select('vocabulary_item_id')
    .eq('learning_group_id', groupId);

  if (groupWordsError) {
    throw new Error(`learning_group_words lookup failed: ${groupWordsError.message}`);
  }

  const targetWordIds = Array.from(
    new Set(((groupWords ?? []) as GroupWordRow[]).map((row) => row.vocabulary_item_id).filter(Boolean)),
  );

  let removedReviewStateCount = 0;

  if (targetWordIds.length > 0) {
    const { data: sharedWords, error: sharedWordsError } = await supabaseAdmin
      .from('learning_group_words')
      .select('vocabulary_item_id, learning_groups!inner(user_id)')
      .in('vocabulary_item_id', targetWordIds)
      .neq('learning_group_id', groupId)
      .eq('learning_groups.user_id', userId);

    if (sharedWordsError) {
      throw new Error(`shared learning_group_words lookup failed: ${sharedWordsError.message}`);
    }

    const sharedWordIds = new Set(
      ((sharedWords ?? []) as SharedWordRow[]).map((row) => row.vocabulary_item_id).filter(Boolean),
    );
    const orphanWordIds = targetWordIds.filter((wordId) => !sharedWordIds.has(wordId));

    if (orphanWordIds.length > 0) {
      const { error: reviewEventsError } = await supabaseAdmin
        .from('review_events')
        .delete()
        .eq('user_id', userId)
        .in('vocabulary_item_id', orphanWordIds);

      if (reviewEventsError) {
        throw new Error(`review_events delete failed: ${reviewEventsError.message}`);
      }

      const { error: reviewStatesError, count } = await supabaseAdmin
        .from('review_states')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .in('vocabulary_item_id', orphanWordIds);

      if (reviewStatesError) {
        throw new Error(`review_states delete failed: ${reviewStatesError.message}`);
      }

      removedReviewStateCount = count ?? 0;
    }
  }

  const { error: deleteGroupError } = await supabaseAdmin
    .from('learning_groups')
    .delete()
    .eq('id', groupId)
    .eq('user_id', userId);

  if (deleteGroupError) {
    throw new Error(`learning_groups delete failed: ${deleteGroupError.message}`);
  }

  return {
    deletedGroupId: groupId,
    deletedWordCount: targetWordIds.length,
    removedReviewStateCount,
  };
}
