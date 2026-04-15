DROP POLICY IF EXISTS "public_all" ON learning_groups;
DROP POLICY IF EXISTS "public_all" ON learning_group_words;
DROP POLICY IF EXISTS "public_all" ON review_states;
DROP POLICY IF EXISTS "public_all" ON review_events;
DROP POLICY IF EXISTS "public_all" ON generated_articles;

CREATE POLICY "learning_groups_owner_select" ON learning_groups
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "learning_groups_owner_insert" ON learning_groups
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "learning_groups_owner_update" ON learning_groups
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "learning_groups_owner_delete" ON learning_groups
  FOR DELETE USING (auth.uid()::text = user_id);

CREATE POLICY "learning_group_words_owner_select" ON learning_group_words
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM learning_groups lg
      WHERE lg.id = learning_group_words.learning_group_id
        AND lg.user_id = auth.uid()::text
    )
  );
CREATE POLICY "learning_group_words_owner_insert" ON learning_group_words
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM learning_groups lg
      WHERE lg.id = learning_group_words.learning_group_id
        AND lg.user_id = auth.uid()::text
    )
  );
CREATE POLICY "learning_group_words_owner_update" ON learning_group_words
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM learning_groups lg
      WHERE lg.id = learning_group_words.learning_group_id
        AND lg.user_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM learning_groups lg
      WHERE lg.id = learning_group_words.learning_group_id
        AND lg.user_id = auth.uid()::text
    )
  );
CREATE POLICY "learning_group_words_owner_delete" ON learning_group_words
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM learning_groups lg
      WHERE lg.id = learning_group_words.learning_group_id
        AND lg.user_id = auth.uid()::text
    )
  );

CREATE POLICY "review_states_owner_select" ON review_states
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "review_states_owner_insert" ON review_states
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "review_states_owner_update" ON review_states
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "review_states_owner_delete" ON review_states
  FOR DELETE USING (auth.uid()::text = user_id);

CREATE POLICY "review_events_owner_select" ON review_events
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "review_events_owner_insert" ON review_events
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "review_events_owner_update" ON review_events
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "review_events_owner_delete" ON review_events
  FOR DELETE USING (auth.uid()::text = user_id);

CREATE POLICY "generated_articles_owner_select" ON generated_articles
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "generated_articles_owner_insert" ON generated_articles
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "generated_articles_owner_update" ON generated_articles
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "generated_articles_owner_delete" ON generated_articles
  FOR DELETE USING (auth.uid()::text = user_id);
