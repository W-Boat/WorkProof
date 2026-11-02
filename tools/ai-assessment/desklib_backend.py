"""Local adapter for the published Desklib mean-pooling/single-logit architecture.

No upstream Python is loaded. Fixed safetensors must match every local module key.
Architecture reference: pinned model card in engines.json (not a quality claim).
"""


def scores(folder, encoded):
    import torch
    from safetensors.torch import load_file
    from transformers import AutoConfig, AutoModel

    config = AutoConfig.from_pretrained(folder, local_files_only=True, trust_remote_code=False)
    if (config.model_type != 'deberta-v2' or config.hidden_size != 1024
            or config.num_hidden_layers != 24 or config.vocab_size != 128100
            or config.architectures != ['DesklibAIDetectionModel']):
        raise ValueError('UNEXPECTED_DESKLIB_ARCHITECTURE')

    class LocalClassifier(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.model = AutoModel.from_config(config, trust_remote_code=False)
            self.classifier = torch.nn.Linear(config.hidden_size, 1)

        def forward(self, tokens):
            states = self.model(**tokens).last_hidden_state
            mask = tokens['attention_mask'].unsqueeze(-1).to(states.dtype)
            pooled = (states * mask).sum(dim=1) / mask.sum(dim=1).clamp_min(1e-9)
            return self.classifier(pooled).reshape(-1)

    model = LocalClassifier()
    state = load_file(str(folder / 'model.safetensors'), device='cpu')
    model.load_state_dict(state, strict=True)
    del state
    model.eval()
    with torch.inference_mode():
        logit = model(encoded)
        if logit.shape != (1,) or not torch.isfinite(logit).all():
            raise ValueError('INVALID_MODEL_OUTPUT')
        ai = torch.sigmoid(logit).item()
    return {'Human': 1 - ai, 'AI': ai}
