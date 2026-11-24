# Voice quality on this machine

Run: 2026-11-23 03:50 UTC. Script: `scripts/e2e/voice-quality.ts`. Machine: darwin arm64, 10 cores, Bun 1.3.14.

Local voice = Kokoro-82M v1.0 (`q8`), the `local` text-to-speech provider. Comparison voice = macOS `say` (Luciana pt-BR, Mónica es-ES, Samantha en-US). Each of 10 sentences per language (dates, names, numbers) was spoken, brought to 16 kHz mono and read back by local Whisper (`q8`) told the language. Accuracy is 1 minus the word error rate; case, accents and punctuation are not counted; digits are compared as written (a model that writes a number in words is charged for it). Both voices are synthetic and clean: a real person, a noisy room or an accent is harder, so read the numbers as a ranking of models, not as the rate a person will see.

## Speed of the local voice

First use (download already done): 0.7 s to load the model and speak one word. Then, median of 3 runs, one text at a time, 10-core machine, nothing else heavy running.

| Language | Text             | Audio  | First audio | Total  | Real-time factor |
| -------- | ---------------- | ------ | ----------- | ------ | ---------------- |
| pt-BR    | short (26 chars) | 2.0 s  | 0.90 s      | 0.90 s | 0.45             |
| pt-BR    | long (214 chars) | 12.8 s | 3.12 s      | 6.03 s | 0.47             |
| es-ES    | short (27 chars) | 1.9 s  | 0.94 s      | 0.94 s | 0.48             |
| es-ES    | long (229 chars) | 12.8 s | 3.28 s      | 5.91 s | 0.46             |
| en-US    | short (31 chars) | 1.9 s  | 0.95 s      | 0.95 s | 0.49             |
| en-US    | long (215 chars) | 12.9 s | 3.58 s      | 6.09 s | 0.47             |

Real-time factor = time to make the audio / length of the audio; below 1 is faster than speech. First audio is the time to the first sentence, not the first sample.

## Word accuracy, round trip

| Voice          | Language | whisper-small | whisper-medium | whisper-large-v3-turbo |
| -------------- | -------- | ------------- | -------------- | ---------------------- |
| local (Kokoro) | pt-BR    | 90%           | 93%            | 95%                    |
| local (Kokoro) | es-ES    | 98%           | 99%            | 100%                   |
| local (Kokoro) | en-US    | 97%           | 95%            | 97%                    |
| say            | pt-BR    | 90%           | 94%            | 96%                    |
| say            | es-ES    | 59%           | 71%            | 83%                    |
| say            | en-US    | 96%           | 95%            | 96%                    |

## Whisper models

| Model                                 | Download (on disk) | Load + first clip        | Transcription of 60 clips | Per clip |
| ------------------------------------- | ------------------ | ------------------------ | ------------------------- | -------- |
| Xenova/whisper-small                  | 252 MB             | 2 s                      | 61 s                      | 1.0 s    |
| Xenova/whisper-medium                 | 779 MB             | 22 s (download included) | 155 s                     | 2.6 s    |
| onnx-community/whisper-large-v3-turbo | 1088 MB            | 4 s                      | 174 s                     | 2.9 s    |

## What each model heard (local voice, Portuguese)

- whisper-small #1: "Me lembre de ligar para a Marina na quarta-feira às 15 horas." -> "Me lembre de ligar para a Marina na quarta-feira às 15 horas."
- whisper-small #2: "A reunião com o João foi marcada para o dia 12 de março." -> "A reunião com o João foi marcada para o dia 12 de março."
- whisper-small #3: "Quanto custa a passagem de São Paulo para Recife em julho?" -> "Quanto custa a passagem de São Paulo para a Qcifi em julho?"
- whisper-small #4: "Adicione leite, pão e 6 ovos na lista de compras." -> "Adicione leite e pão e seis ovos na lista de compras."
- whisper-small #5: "O aniversário da Fernanda é no dia 28 de setembro." -> "O aniversário da Fernanda é no dia 28 de setembro."
- whisper-small #6: "Envie a fatura de 350 reais para o cliente até sexta-feira." -> "Envia a fatura de R$ 350 para o cliente até sexta-feira."
- whisper-small #7: "Qual é a previsão do tempo para amanhã em Curitiba?" -> "Qual é a previsão do tempo para amanhã em Curitiba?"
- whisper-small #8: "Agende uma consulta com a doutora Beatriz na próxima segunda." -> "Agende uma consulta com a doutora Beatriz na próxima segunda."
- whisper-small #9: "Preciso de 20 minutos para terminar o relatório do Carlos." -> "Preciso de 20 minutos para terminar o relatório do Carlos."
- whisper-small #10: "Cancele a reserva do restaurante e avise o Pedro." -> "Cancelem a queserva do questaurante e avise o Pedro."
- whisper-medium #1: "Me lembre de ligar para a Marina na quarta-feira às 15 horas." -> "Me lembre de ligar para Marina na quarta-feira às 15 horas."
- whisper-medium #2: "A reunião com o João foi marcada para o dia 12 de março." -> "A que a união com o João foi marcada para o dia 12 de março."
- whisper-medium #3: "Quanto custa a passagem de São Paulo para Recife em julho?" -> "Quanto custa a passagem de São Paulo para Quesif em julho?"
- whisper-medium #4: "Adicione leite, pão e 6 ovos na lista de compras." -> "Adicione leite, pão e seis ovos na lista de compras."
- whisper-medium #5: "O aniversário da Fernanda é no dia 28 de setembro." -> "O aniversário da Fernanda é no dia 28 de setembro."
- whisper-medium #6: "Envie a fatura de 350 reais para o cliente até sexta-feira." -> "Envie a fatura de R$ 350,00 para o cliente até sexta-feira."
- whisper-medium #7: "Qual é a previsão do tempo para amanhã em Curitiba?" -> "Qual é a previsão do tempo para amanhã em Curitiba?"
- whisper-medium #8: "Agende uma consulta com a doutora Beatriz na próxima segunda." -> "Agende uma consulta com a doutora Beatriz na próxima segunda."
- whisper-medium #9: "Preciso de 20 minutos para terminar o relatório do Carlos." -> "Preciso de 20 minutos para terminar o relatório do Carlos."
- whisper-medium #10: "Cancele a reserva do restaurante e avise o Pedro." -> "Cancele a reserva do restaurante e avise o Pedro."
- whisper-large-v3-turbo #1: "Me lembre de ligar para a Marina na quarta-feira às 15 horas." -> "Me lembre de ligar para a Marina na quarta-feira às 15 horas."
- whisper-large-v3-turbo #2: "A reunião com o João foi marcada para o dia 12 de março." -> "A reunião com o João foi marcada para o dia 12 de março."
- whisper-large-v3-turbo #3: "Quanto custa a passagem de São Paulo para Recife em julho?" -> "Quanto custa a passagem de São Paulo para Cicifia em julho?"
- whisper-large-v3-turbo #4: "Adicione leite, pão e 6 ovos na lista de compras." -> "Adicione leite, pão e seis ovos na lista de compras."
- whisper-large-v3-turbo #5: "O aniversário da Fernanda é no dia 28 de setembro." -> "O aniversário da Fernanda é no dia 28 de setembro."
- whisper-large-v3-turbo #6: "Envie a fatura de 350 reais para o cliente até sexta-feira." -> "Envie a fatura de R$ 350 para o cliente até sexta-feira."
- whisper-large-v3-turbo #7: "Qual é a previsão do tempo para amanhã em Curitiba?" -> "Qual é a previsão do tempo para amanhã em Curitiba?"
- whisper-large-v3-turbo #8: "Agende uma consulta com a doutora Beatriz na próxima segunda." -> "Agende uma consulta com a doutora Beatriz na próxima segunda."
- whisper-large-v3-turbo #9: "Preciso de 20 minutos para terminar o relatório do Carlos." -> "Preciso de 20 minutos para terminar o quelatório do Carlos."
- whisper-large-v3-turbo #10: "Cancele a reserva do restaurante e avise o Pedro." -> "Cancele a reserva do restaurante e avise o Pedro."
