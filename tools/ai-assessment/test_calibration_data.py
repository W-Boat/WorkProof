"""Synthetic selection invariants; no inference, downloads or quality claims."""
import io
import json
import unittest

import calibration_data as data


class CalibrationSelectionTests(unittest.TestCase):
    def test_independent_namespace_preserves_grouping_and_exclusions(self):
        rows = self.fixtures()
        old, _, _ = self.select(rows)
        exposed = set.union(*self.hashes(old).values())
        namespace = 'workproof-detectorscope-calibration-v1'
        def select(values):
            return data.select_rows(io.StringIO(json.dumps(values)), exposed, 2, namespace)[0]
        fresh = select(rows)
        self.assertEqual(self.hashes(fresh), self.hashes(select(list(reversed(rows)))))
        self.assertFalse(exposed & set.union(*self.hashes(fresh).values()))
        self.assertFalse(self.hashes(fresh)['calibration'] & self.hashes(fresh)['heldout'])
        for part, subset in fresh.items():
            for row in subset:
                if row['truth'] == 'human':
                    self.assertEqual(data.partition(data.ev.digest(row['text'].encode()), namespace), part)
        for invalid in ('', 'has spaces', 'x\0y', None):
            with self.assertRaisesRegex(ValueError, 'NAMESPACE'):
                data.select_rows(io.StringIO('[]'), set(), 2, invalid)

    def fixtures(self):
        rows = []
        for language in ('english', 'chinese'):
            for domain in ('News', 'Academic Writing'):
                for i in range(100):
                    for model in ('deepseek-v3', 'gpt-4o'):
                        rows.append(dict(lang=language, model=model, domain=domain, split='test',
                                         human_written_text=f'human {language} {domain} {i}',
                                         llm_generated_text=f'ai {language} {domain} {model} {i}'))
        return rows

    def select(self, rows, excluded=(), quota=2):
        return data.select_rows(io.StringIO(json.dumps(rows)), set(excluded), quota)

    def hashes(self, selected):
        return {part: {data.ev.digest(row['text'].encode()) for row in rows}
                for part, rows in selected.items()}

    def test_balanced_disjoint_deterministic_group_assignment(self):
        rows = self.fixtures()
        selected, counts, cells = self.select(rows)
        self.assertEqual(counts['source_rows'], len(rows))
        self.assertEqual(len(cells), 16)
        self.assertEqual(set(cells.values()), {2})
        hashes = self.hashes(selected)
        self.assertFalse(hashes['calibration'] & hashes['heldout'])
        for part, subset in selected.items():
            self.assertEqual(len(subset), len(hashes[part]))
            for row in subset:
                if row['truth'] == 'human':
                    self.assertEqual(data.partition(data.ev.digest(row['text'].encode())), part)
        reordered, _, _ = self.select(list(reversed(rows)))
        self.assertEqual(hashes, self.hashes(reordered))

    def test_exposed_ai_excludes_entire_original_human_group(self):
        rows = self.fixtures()
        chosen, _, _ = self.select(rows)
        sample = next(row for row in chosen['heldout'] if row['truth'] == 'ai')
        exposed = next(row for row in rows if row['llm_generated_text'] == sample['text'])
        blocked_human = exposed['human_written_text']
        excluded = {data.ev.digest(sample['text'].encode())}
        selected, _, _ = self.select(rows, excluded)
        all_text = [row['text'] for subset in selected.values() for row in subset]
        self.assertNotIn(blocked_human, all_text)
        for row in rows:
            if row['human_written_text'] == blocked_human:
                self.assertNotIn(row['llm_generated_text'], all_text)
        self.assertFalse(excluded & set.union(*self.hashes(selected).values()))

    def test_shortfalls_fail_instead_of_silently_reducing_sample_count(self):
        rows = self.fixtures()
        with self.assertRaisesRegex(ValueError, 'STRATA_INCOMPLETE'):
            self.select(rows[:1])
        for quota in (0, 17, True):
            with self.assertRaisesRegex(ValueError, 'QUOTA'):
                self.select(rows, quota=quota)
        with self.assertRaisesRegex(ValueError, 'PRIOR_HASH'):
            self.select(rows, excluded={'invalid'})

    def test_training_rows_and_invalid_schema(self):
        rows = self.fixtures()
        train = dict(rows[0], split='train', human_written_text='training', llm_generated_text='training ai')
        selected, _, _ = self.select([train] + rows)
        self.assertNotIn('training', [row['text'] for subset in selected.values() for row in subset])
        for bad in (dict(rows[0], model='unknown'), dict(rows[0], domain=''), dict(rows[0], human_written_text=None)):
            with self.assertRaises(ValueError):
                self.select([bad] + rows)


if __name__ == '__main__':
    unittest.main()
