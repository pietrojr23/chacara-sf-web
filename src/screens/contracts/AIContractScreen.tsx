import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppInput } from '../../components/AppInput';
import { ScreenContainer } from '../../components/ScreenContainer';
import { SectionHeader } from '../../components/SectionHeader';
import { palette, spacing } from '../../constants/theme';
import { generateRentalContractWithGroq, type PersonContractData } from '../../services/groqService';
import { generateContractPdf, sharePdf } from '../../services/pdfService';

const parseMoneyInput = (value: string) => {
  const cleaned = value.replace(/[^\d,.-]/g, '').trim();
  if (!cleaned) {
    return 0;
  }

  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+$/.test(cleaned)
      ? cleaned.replace(/\./g, '')
      : cleaned;

  const result = Number(normalized);
  return Number.isFinite(result) && result > 0 ? result : 0;
};

const parsePositiveInt = (value: string) => {
  const result = Number(value.replace(/\D/g, ''));
  return Number.isFinite(result) && result > 0 ? Math.round(result) : 0;
};

const createEmptyPerson = (): PersonContractData => ({
  nome: '',
  nacionalidade: '',
  estadoCivil: '',
  profissao: '',
  rg: '',
  rgUf: '',
  cpf: '',
  endereco: '',
});

export const AIContractScreen = () => {
  const [locadora, setLocadora] = useState<PersonContractData>(createEmptyPerson());
  const [locatario, setLocatario] = useState<PersonContractData>(createEmptyPerson());
  const [fiador, setFiador] = useState<PersonContractData>(createEmptyPerson());
  const [imovelDescricao, setImovelDescricao] = useState('');
  const [imovelEndereco, setImovelEndereco] = useState('');
  const [imovelMatricula, setImovelMatricula] = useState('');
  const [imovelCartorio, setImovelCartorio] = useState('');
  const [valorAluguelInput, setValorAluguelInput] = useState('');
  const [diaVencimento, setDiaVencimento] = useState('');
  const [prazoMesesInput, setPrazoMesesInput] = useState('12');
  const [dataInicio, setDataInicio] = useState('');
  const [formaPagamento, setFormaPagamento] = useState('');
  const [indiceReajusteAnual, setIndiceReajusteAnual] = useState('IGPM-FGV (ou IPCA/IBGE como substituto)');
  const [multaAtraso, setMultaAtraso] = useState('10% + juros de 1% ao mês + correção monetária (IGP-DI/FGV)');
  const [multaRescisaoAntecipada, setMultaRescisaoAntecipada] = useState(
    '3 alugueres vigentes (proporcional após 12 meses)',
  );
  const [isencaoMultaRescisaoApos, setIsencaoMultaRescisaoApos] = useState(
    '24 meses, com aviso prévio de 60 dias',
  );
  const [finalidade, setFinalidade] = useState('residencial');
  const [foroComarca, setForoComarca] = useState('');
  const [cidadeAssinatura, setCidadeAssinatura] = useState('');
  const [dataAssinatura, setDataAssinatura] = useState('');
  const [clausulasAdicionais, setClausulasAdicionais] = useState('');
  const [contractPreview, setContractPreview] = useState('');
  const [loading, setLoading] = useState(false);

  const valorAluguel = useMemo(() => parseMoneyInput(valorAluguelInput), [valorAluguelInput]);
  const prazoMeses = useMemo(() => parsePositiveInt(prazoMesesInput), [prazoMesesInput]);

  const updatePersonField = (
    setter: Dispatch<SetStateAction<PersonContractData>>,
    key: keyof PersonContractData,
    value: string,
  ) => {
    setter((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const validatePerson = (person: PersonContractData, label: string) => {
    if (!person.nome.trim()) return `Informe o nome de ${label}.`;
    if (!person.cpf.trim()) return `Informe o CPF de ${label}.`;
    if (!person.rg.trim()) return `Informe o RG de ${label}.`;
    if (!person.rgUf.trim()) return `Informe UF do RG de ${label}.`;
    if (!person.endereco.trim()) return `Informe o endereço de ${label}.`;
    return null;
  };

  const validate = () => {
    const personChecks = [
      validatePerson(locadora, 'locadora'),
      validatePerson(locatario, 'locatário'),
      validatePerson(fiador, 'fiador'),
    ].filter(Boolean);

    if (personChecks.length > 0) {
      return personChecks[0];
    }

    if (!imovelDescricao.trim()) return 'Informe a descrição do imóvel.';
    if (!imovelEndereco.trim()) return 'Informe o endereço do imóvel.';
    if (!imovelMatricula.trim()) return 'Informe a matrícula do imóvel.';
    if (!imovelCartorio.trim()) return 'Informe o cartório da matrícula.';
    if (!diaVencimento.trim()) return 'Informe o dia de vencimento.';
    if (!dataInicio.trim()) return 'Informe a data de início do contrato.';
    if (!formaPagamento.trim()) return 'Informe a forma de pagamento.';
    if (!foroComarca.trim()) return 'Informe o foro da comarca.';
    if (!cidadeAssinatura.trim()) return 'Informe a cidade da assinatura.';
    if (!dataAssinatura.trim()) return 'Informe a data da assinatura.';
    if (valorAluguel <= 0) return 'Informe um valor mensal válido.';
    if (prazoMeses <= 0) return 'Informe um prazo válido em meses.';
    return null;
  };

  const handleGenerateContractPdf = async () => {
    const error = validate();
    if (error) {
      Alert.alert('Dados incompletos', error);
      return;
    }

    try {
      setLoading(true);
      const text = await generateRentalContractWithGroq({
        locadora,
        locatario,
        fiador,
        imovelDescricao: imovelDescricao.trim(),
        imovelEndereco: imovelEndereco.trim(),
        imovelMatricula: imovelMatricula.trim(),
        imovelCartorio: imovelCartorio.trim(),
        valorAluguel,
        diaVencimento: diaVencimento.trim(),
        prazoMeses,
        dataInicio: dataInicio.trim(),
        formaPagamento: formaPagamento.trim(),
        indiceReajusteAnual: indiceReajusteAnual.trim(),
        multaAtraso: multaAtraso.trim(),
        multaRescisaoAntecipada: multaRescisaoAntecipada.trim(),
        isencaoMultaRescisaoApos: isencaoMultaRescisaoApos.trim(),
        finalidade: finalidade.trim(),
        foroComarca: foroComarca.trim(),
        cidadeAssinatura: cidadeAssinatura.trim(),
        dataAssinatura: dataAssinatura.trim(),
        clausulasAdicionais: clausulasAdicionais.trim(),
      });

      setContractPreview(text);

      const pdfUri = await generateContractPdf({
        title: 'Instrumento Particular de Contrato de Locação Residencial com Fiador',
        contractText: text,
      });
      await sharePdf(pdfUri);
    } catch (generationError) {
      const message = generationError instanceof Error ? generationError.message : 'Falha ao gerar contrato.';
      Alert.alert('Erro', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer>
      <SectionHeader
        title="Contrato de aluguel com IA"
        subtitle="Modelo completo com fiador, gerado pela Groq e exportado em PDF"
      />

      <AppCard>
        <Text style={styles.groupTitle}>Dados da locadora</Text>
        <AppInput
          label="Nome"
          value={locadora.nome}
          onChangeText={(value) => updatePersonField(setLocadora, 'nome', value)}
        />
        <AppInput
          label="Nacionalidade"
          value={locadora.nacionalidade}
          onChangeText={(value) => updatePersonField(setLocadora, 'nacionalidade', value)}
        />
        <AppInput
          label="Estado civil"
          value={locadora.estadoCivil}
          onChangeText={(value) => updatePersonField(setLocadora, 'estadoCivil', value)}
        />
        <AppInput
          label="Profissão"
          value={locadora.profissao}
          onChangeText={(value) => updatePersonField(setLocadora, 'profissao', value)}
        />
        <View style={styles.row}>
          <View style={styles.rowItemWide}>
            <AppInput label="RG" value={locadora.rg} onChangeText={(value) => updatePersonField(setLocadora, 'rg', value)} />
          </View>
          <View style={styles.rowItemNarrow}>
            <AppInput
              label="UF RG"
              value={locadora.rgUf}
              onChangeText={(value) => updatePersonField(setLocadora, 'rgUf', value)}
              placeholder="SP"
            />
          </View>
        </View>
        <AppInput
          label="CPF"
          value={locadora.cpf}
          onChangeText={(value) => updatePersonField(setLocadora, 'cpf', value)}
        />
        <AppInput
          label="Endereço completo"
          value={locadora.endereco}
          onChangeText={(value) => updatePersonField(setLocadora, 'endereco', value)}
          multiline
        />
      </AppCard>

      <AppCard>
        <Text style={styles.groupTitle}>Dados do locatário</Text>
        <AppInput
          label="Nome"
          value={locatario.nome}
          onChangeText={(value) => updatePersonField(setLocatario, 'nome', value)}
        />
        <AppInput
          label="Nacionalidade"
          value={locatario.nacionalidade}
          onChangeText={(value) => updatePersonField(setLocatario, 'nacionalidade', value)}
        />
        <AppInput
          label="Estado civil"
          value={locatario.estadoCivil}
          onChangeText={(value) => updatePersonField(setLocatario, 'estadoCivil', value)}
        />
        <AppInput
          label="Profissão"
          value={locatario.profissao}
          onChangeText={(value) => updatePersonField(setLocatario, 'profissao', value)}
        />
        <View style={styles.row}>
          <View style={styles.rowItemWide}>
            <AppInput label="RG" value={locatario.rg} onChangeText={(value) => updatePersonField(setLocatario, 'rg', value)} />
          </View>
          <View style={styles.rowItemNarrow}>
            <AppInput
              label="UF RG"
              value={locatario.rgUf}
              onChangeText={(value) => updatePersonField(setLocatario, 'rgUf', value)}
              placeholder="SP"
            />
          </View>
        </View>
        <AppInput
          label="CPF"
          value={locatario.cpf}
          onChangeText={(value) => updatePersonField(setLocatario, 'cpf', value)}
        />
        <AppInput
          label="Endereço atual"
          value={locatario.endereco}
          onChangeText={(value) => updatePersonField(setLocatario, 'endereco', value)}
          multiline
        />
      </AppCard>

      <AppCard>
        <Text style={styles.groupTitle}>Dados do fiador</Text>
        <AppInput
          label="Nome"
          value={fiador.nome}
          onChangeText={(value) => updatePersonField(setFiador, 'nome', value)}
        />
        <AppInput
          label="Nacionalidade"
          value={fiador.nacionalidade}
          onChangeText={(value) => updatePersonField(setFiador, 'nacionalidade', value)}
        />
        <AppInput
          label="Estado civil"
          value={fiador.estadoCivil}
          onChangeText={(value) => updatePersonField(setFiador, 'estadoCivil', value)}
        />
        <AppInput
          label="Profissão"
          value={fiador.profissao}
          onChangeText={(value) => updatePersonField(setFiador, 'profissao', value)}
        />
        <View style={styles.row}>
          <View style={styles.rowItemWide}>
            <AppInput label="RG" value={fiador.rg} onChangeText={(value) => updatePersonField(setFiador, 'rg', value)} />
          </View>
          <View style={styles.rowItemNarrow}>
            <AppInput
              label="UF RG"
              value={fiador.rgUf}
              onChangeText={(value) => updatePersonField(setFiador, 'rgUf', value)}
              placeholder="SP"
            />
          </View>
        </View>
        <AppInput
          label="CPF"
          value={fiador.cpf}
          onChangeText={(value) => updatePersonField(setFiador, 'cpf', value)}
        />
        <AppInput
          label="Endereço completo"
          value={fiador.endereco}
          onChangeText={(value) => updatePersonField(setFiador, 'endereco', value)}
          multiline
        />
      </AppCard>

      <AppCard>
        <Text style={styles.groupTitle}>Dados do imóvel e da locação</Text>
        <AppInput
          label="Descrição do imóvel"
          value={imovelDescricao}
          onChangeText={setImovelDescricao}
          placeholder="Ex.: casa com 2 quartos, sala, cozinha e banheiro"
          multiline
        />
        <AppInput
          label="Endereço completo do imóvel"
          value={imovelEndereco}
          onChangeText={setImovelEndereco}
          multiline
        />
        <AppInput
          label="Matrícula do imóvel"
          value={imovelMatricula}
          onChangeText={setImovelMatricula}
          placeholder="Nº da matrícula"
        />
        <AppInput
          label="Cartório"
          value={imovelCartorio}
          onChangeText={setImovelCartorio}
          placeholder="Nome do cartório"
        />
        <AppInput
          label="Valor do aluguel (R$)"
          value={valorAluguelInput}
          onChangeText={setValorAluguelInput}
          keyboardType="decimal-pad"
          placeholder="Ex.: 1500,00"
        />
        <View style={styles.row}>
          <View style={styles.rowItemWide}>
            <AppInput
              label="Dia de vencimento"
              value={diaVencimento}
              onChangeText={setDiaVencimento}
              keyboardType="number-pad"
              placeholder="Ex.: 10"
            />
          </View>
          <View style={styles.rowItemWide}>
            <AppInput
              label="Prazo (meses)"
              value={prazoMesesInput}
              onChangeText={setPrazoMesesInput}
              keyboardType="number-pad"
              placeholder="Ex.: 12"
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.rowItemWide}>
            <AppInput label="Início" value={dataInicio} onChangeText={setDataInicio} placeholder="dd/mm/aaaa" />
          </View>
        </View>
        <AppInput
          label="Forma de pagamento"
          value={formaPagamento}
          onChangeText={setFormaPagamento}
          multiline
          placeholder="Ex.: depósito bancário Banco X, ag. XXXX, conta XXXXX-X"
        />
        <AppInput label="Índice de reajuste anual" value={indiceReajusteAnual} onChangeText={setIndiceReajusteAnual} />
        <AppInput label="Multa por atraso" value={multaAtraso} onChangeText={setMultaAtraso} multiline />
        <AppInput
          label="Multa por rescisão antecipada"
          value={multaRescisaoAntecipada}
          onChangeText={setMultaRescisaoAntecipada}
          multiline
        />
        <AppInput
          label="Isenção de multa de rescisão após"
          value={isencaoMultaRescisaoApos}
          onChangeText={setIsencaoMultaRescisaoApos}
          placeholder="Ex.: 24 meses, com aviso prévio de 60 dias"
        />
        <AppInput label="Finalidade" value={finalidade} onChangeText={setFinalidade} placeholder="residencial" />
      </AppCard>

      <AppCard>
        <Text style={styles.groupTitle}>Foro e assinatura</Text>
        <AppInput
          label="Foro da comarca"
          value={foroComarca}
          onChangeText={setForoComarca}
          placeholder="Cidade/UF"
        />
        <AppInput
          label="Cidade da assinatura"
          value={cidadeAssinatura}
          onChangeText={setCidadeAssinatura}
          placeholder="Cidade"
        />
        <AppInput
          label="Data da assinatura"
          value={dataAssinatura}
          onChangeText={setDataAssinatura}
          placeholder="dd/mm/aaaa"
        />
        <AppInput
          label="Cláusulas adicionais (opcional)"
          value={clausulasAdicionais}
          onChangeText={setClausulasAdicionais}
          multiline
        />
        <AppButton
          label="Gerar contrato em PDF (Groq IA)"
          onPress={handleGenerateContractPdf}
          loading={loading}
        />
      </AppCard>

      <AppCard>
        <Text style={styles.previewTitle}>Pré-visualização do texto</Text>
        <Text style={styles.previewBody}>
          {contractPreview.trim() || 'Após gerar, o texto do contrato aparecerá aqui.'}
        </Text>
      </AppCard>

      <View style={styles.noteBox}>
        <Text style={styles.noteText}>
          Este módulo gera rascunho de contrato por IA. Faça revisão jurídica antes de assinar.
        </Text>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  groupTitle: {
    color: palette.gray900,
    fontSize: 15,
    fontWeight: '800',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rowItemWide: {
    flex: 1,
  },
  rowItemNarrow: {
    width: 84,
  },
  previewTitle: {
    color: palette.gray900,
    fontSize: 15,
    fontWeight: '800',
  },
  previewBody: {
    color: palette.gray700,
    fontSize: 15,
    lineHeight: 20,
  },
  noteBox: {
    paddingHorizontal: spacing.sm,
  },
  noteText: {
    color: palette.gray700,
    fontSize: 15,
  },
});
