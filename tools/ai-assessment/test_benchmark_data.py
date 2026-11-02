"""Selection and container fixtures, not benchmark accuracy or source licensing."""
import io
import json
import unittest
import benchmark_data as data


class SlowStream(io.StringIO):
    def read(self, size=-1):
        return super().read(min(size, 7))


class BenchmarkSelectionTests(unittest.TestCase):
    def fixtures(self):
        rows=[]
        for language in ('english','chinese'):
            for model in ('deepseek-v3','gpt-4o'):
                for domain in ('News','Academic Writing'):
                    for index in range(6):
                        rows.append(dict(lang=language,model=model,domain=domain,split='test',human_written_text=f'human {language} {domain} {index}',llm_generated_text=f'ai {model} {language} {domain} {index}'))
        return rows

    def test_stream_boundaries_and_rejection_of_ambiguous_containers(self):
        text=json.dumps([{'text':'中文'}, {'next':'value'}],ensure_ascii=False)
        self.assertEqual([row for index,row in data.stream_objects(SlowStream(text))],[{'text':'中文'},{'next':'value'}])
        for invalid in ('{}','[1]','[{"x":1,"x":2}]','[{} {}]','[{},]','[{}','[{}] trailing','[{"x":NaN}]'):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                list(data.stream_objects(SlowStream(invalid)))
        with self.assertRaisesRegex(ValueError,'OBJECT_LIMIT'):
            list(data.stream_objects(io.StringIO(json.dumps([{'x':'a'*500}])),max_object=128))

    def test_hash_selection_is_deterministic_balanced_and_deduplicated(self):
        rows=self.fixtures()
        selected,counts,cells=data.select_rows(io.StringIO(json.dumps(rows)),quota=2)
        self.assertEqual(len(selected),32)
        self.assertEqual(len(cells),8)
        self.assertEqual(set(cells.values()),{2})
        self.assertEqual(counts['source_rows'],len(rows))
        hashes=[data.ev.digest(row['text'].encode()) for row in selected]
        self.assertEqual(len(hashes),len(set(hashes)))
        for row in selected:
            self.assertEqual(row['generator']=='human',row['truth']=='human')
            self.assertIn(row['domain'],{'news','academic-writing'})
            self.assertIn('upstream test split',row['source']['record'])
        reordered,_,_=data.select_rows(io.StringIO(json.dumps(list(reversed(rows)))),quota=2)
        self.assertEqual(set(hashes),{data.ev.digest(row['text'].encode()) for row in reordered})

    def test_train_rows_do_not_enter_test_selection_and_invalid_schema_fails(self):
        rows=self.fixtures()
        training=dict(rows[0],split='train',human_written_text='TRAIN_ONLY',llm_generated_text='TRAIN_AI')
        selected,counts,_=data.select_rows(io.StringIO(json.dumps([training]+rows)),quota=1)
        self.assertEqual(counts['non_test_rows'],1)
        self.assertNotIn('TRAIN_ONLY',[row['text'] for row in selected])
        for bad in (dict(rows[0],model='unknown-generator'),dict(rows[0],domain=''),dict(rows[0],human_written_text=None)):
            with self.assertRaises(ValueError):
                data.select_rows(io.StringIO(json.dumps([bad])),quota=1)


if __name__=='__main__':
    unittest.main()
