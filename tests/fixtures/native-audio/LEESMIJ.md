# Eigen synthetische MP3 voor native transporttests

Dit bestand bevat uitsluitend een zelf gegenereerde sinus van 440 Hz, geen
kerkopname, tekst, stem, gebruiker of externe download. Generatie:

```sh
ffmpeg -nostdin -v error -f lavfi -i sine=frequency=440:duration=30 \
  -ac 1 -ar 44100 -codec:a libmp3lame -b:a 128k -map_metadata -1 synthetic.mp3
```

De native tests lezen deze bytes, valideren ranges en laten AVFoundation de
custom-scheme asset analyseren. Dit is geen fysieke toestel- of audioacceptatie.
