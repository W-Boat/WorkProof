---
library_name: detectorscope
license: gemma
base_model: google/gemma-2-2b
pipeline_tag: text-classification
tags:
- ai-text-detection
- sparse-autoencoder
- interpretability
---

# detector-scope

Detects AI-generated text across domains and generators (trained on the COLING 2025 GenAI Detection shared task: news, essays, reviews and more, written by people or by 40 language models). The unmodified Gemma-2-2b, sparse autoencoders fine-tuned on this data, and a sparse logistic-regression head over their features: the best general-domain detector of the paper. Every prediction is a sum of contributions from sparse-autoencoder
features, each with a validated natural-language description, so the detector
can say which properties of the text drove its decision and where they occur.
Paper: [Building Auditable AI Text Detectors with Sparse Autoencoders](https://arxiv.org/abs/2610.30006);
code: [google-deepmind/detectorscope](https://github.com/google-deepmind/detectorscope).

## Use

```bash
pip install detectorscope
```

```python
from detectorscope import AuditableDetector

det = AuditableDetector.from_pretrained("liamdugan/detector-scope")
out = det("The authors propose a novel framework for ...")

out.p_ai       # probability that the text is AI-written
out.label      # "ai" or "human" (logit threshold +0.50)
out.features   # [Feature(id, importance, description, highlights), ...]
```

`out.features` lists every feature active in the text with a non-zero effect,
largest effect first. `importance` is how much the logit falls if that feature
is silenced: positive pushes toward AI, negative toward human, and
`out.logit == out.bias + sum(f.importance for f in out.features)`. A list of
texts returns a list of detections.

To see where a feature fires:

```python
out = det(text, return_highlights=True)
out.tokens                  # the text as a list of tokens
out.features[0].highlights  # [(token index, activation), ...] of the top feature
```

The default head is logistic regression over the features whose
auto-interpretation score is at least 0.85. `head="xgboost"` or another
`tau` (0.00 to 0.95 in steps of 0.05), on `from_pretrained` or on the call,
selects one of the other 39 heads.

## Performance

Default head; the decision threshold is fixed on the development data.

| split | AUROC | F1 | accuracy | documents |
|---|---|---|---|---|
| COLING dev | 0.932 | 0.867 | 0.839 | 261,758 |
| COLING dev-test | 0.916 | 0.866 | 0.854 | 32,557 |
| COLING test | 0.857 | 0.751 | 0.770 | 73,941 |

## What it looks at

The features with the largest average contribution on the training data
(weight × mean activation when active; density = share of the documents of
each class in which the feature fires).

**Toward AI**

| feature | description | mean contribution | AI density | human density |
|---|---|---|---|---|
| 13_3738 | introductory phrases or filler text commonly used by ai language models when declining personal questions | +0.987 | 25% | 2% |
| 13_1545 | academic and scientific research methodology and technical analysis terminology | +0.909 | 13% | 3% |
| 17_12178 | critical commentary or argumentative analysis of student policies and social responsibility | +0.558 | 38% | 11% |
| 17_8638 | neuron activates on random text fragments and noisy character sequences often found in garbled or fragmented data | +0.372 | 13% | 13% |
| 17_1175 | repeated phrases or sequences in text | +0.363 | 41% | 31% |
| 13_2153 | exclamation points used at the end of emotional or emphatic sentences | +0.318 | 16% | 15% |
| 22_9579 | markdown formatting for headers or list items | +0.297 | 25% | 13% |
| 7_1076 | conversational filler phrases used in informal speech | +0.261 | 15% | 13% |
| 7_7991 | reads more or similar web page navigation links | +0.239 | 8% | 7% |
| 17_4337 | introductory transition words signaling a summary or final thought | +0.210 | 25% | 7% |

**Toward human**

| feature | description | mean contribution | AI density | human density |
|---|---|---|---|---|
| 7_14967 | comma punctuation following a newline or preceding sentence start | -1.563 | 3% | 14% |
| 7_10954 | neuron fires on the digit 0 inside url placeholders like url 0 | -0.951 | 1% | 5% |
| 7_9535 | newline characters in scientific or technical text | -0.842 | 1% | 11% |
| 7_1262 | contractions containing the letter n and apostrophe specifically focusing on the n't ending | -0.785 | 3% | 14% |
| 7_5896 | newline characters in scientific or technical text | -0.658 | 1% | 11% |
| 13_11151 | newline characters in mathematical or technical contexts | -0.473 | 2% | 12% |
| 7_14666 | wikipedia category and navigation section headers | -0.454 | 4% | 10% |
| 22_3894 | semicolon followed by a newline character | -0.394 | 3% | 10% |
| 17_15548 | opening double quotation marks following a closing single quote and comma | -0.374 | 1% | 4% |
| 13_15646 | markdown editing and formatting indicators | -0.366 | 14% | 29% |

## Variants

Branches of this repo hold the paper's other two settings on the same data: `ft-model-sae` (Gemma-2-2b fine-tuned as a classifier, with SAEs fine-tuned on it) and `base-sae` (the unmodified Gemma-2-2b with the Gemma Scope SAEs). Load one with `revision="ft-model-sae"` or `revision="base-sae"`. For reviews of machine-learning papers use [detector-scope-peer-review-gpt4o](https://huggingface.co/liamdugan/detector-scope-peer-review-gpt4o) or [detector-scope-peer-review-llama](https://huggingface.co/liamdugan/detector-scope-peer-review-llama).

## Licence

The language model under `extractor/` is Gemma-2-2b, provided under
and subject to the [Gemma Terms of Use](https://ai.google.dev/gemma/terms)
(see `NOTICE`). The sparse autoencoders derive from
[Gemma Scope](https://huggingface.co/google/gemma-scope-2b-pt-res) (CC-BY-4.0);
the heads and feature descriptions are CC-BY-4.0.

## Citation

```bibtex
@misc{dugan2026detectorscope,
  title={Building Auditable AI Text Detectors with Sparse Autoencoders},
  author={Liam Dugan and Callum McDougall and Matthew Denton and Phillip Pham and Christine Kaeser-Chen and Chris Callison-Burch},
  year={2026},
  eprint={2610.30006},
  archivePrefix={arXiv},
  url={https://arxiv.org/abs/2610.30006},
}
```
